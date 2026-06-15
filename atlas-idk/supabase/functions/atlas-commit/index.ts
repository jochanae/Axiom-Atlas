// Atlas commit edge function — extracts the strongest decision from a session.
// CommitCard Guard validates and normalizes before returning.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { composeAtlasPrompt } from "../_shared/atlas-core.ts";
import { validateCommitCard } from "../_shared/commitcard-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = composeAtlasPrompt(`═══════════════════════════════════════════════════════════════
ROLE — Decision extraction
═══════════════════════════════════════════════════════════════

You are reading a conversation and extracting the single most important architectural or strategic decision that was made. Be precise and ruthless — if no real decision was made, say so.

Apply the card-tone normalization rules to the title and description. The output is a permanent ledger artifact.

Return ONLY valid JSON in this exact structure:
{
  "decision_found": true or false,
  "title": "one clear sentence — what was decided",
  "description": "why this decision was made and what context led to it",
  "constraint": "what this decision prevents or constrains going forward",
  "confidence": "high / medium / low"
}

If decision_found is false, return: {"decision_found": false}
Nothing else. No markdown. No explanation. Pure JSON.`);

type ChatMessage = {
  role: string;
  content: string;
  created_at: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseDecisionJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Claude returned invalid JSON");
    return JSON.parse(match[0]);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) throw new Error("Not authenticated");

    const { sessionId, projectId } = await req.json();
    if (!sessionId || !projectId)
      throw new Error("sessionId and projectId required");

    const { data: session, error: sessionErr } = await userClient
      .from("sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) throw new Error("Session not found");

    const { data: recentMessages, error: messagesErr } = await userClient
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (messagesErr) throw messagesErr;

    const messages = ((recentMessages ?? []) as ChatMessage[]).reverse();
    const transcript = messages
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n\n");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: transcript || "No chat messages were found for this session.",
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      console.error("Claude error", claudeRes.status, text);
      return jsonResponse({ error: `Claude API error: ${claudeRes.status}` }, 502);
    }

    const data = await claudeRes.json();
    const text = (data.content as Array<{ type: string; text?: string }>)
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) throw new Error("Claude returned an empty response");

    const rawDecision = parseDecisionJson(text);

    // ═══ CommitCard Guard — validate before returning ═══
    const validation = validateCommitCard(rawDecision, {
      conversationSnippet: transcript.slice(0, 500),
    });

    if (!validation.valid) {
      console.warn(`commitcard-guard: rejected — ${validation.issues.join(", ")}`);

      // Single retry: ask Claude to fix the specific issues
      if (validation.issues.length > 0 && rawDecision.decision_found !== false) {
        console.log("commitcard-guard: attempting retry with correction prompt");
        const retryRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 700,
            system: SYSTEM_PROMPT,
            messages: [
              { role: "user", content: transcript || "No chat messages." },
              { role: "assistant", content: text },
              {
                role: "user",
                content: `[SYSTEM — CARD VALIDATION FAILED]\nIssues: ${validation.issues.join("; ")}\n\nFix these issues and return the corrected JSON. The title must be a clear, specific decision statement — not "test", "untitled", or "decision". Include a meaningful description.`,
              },
            ],
          }),
        });

        if (retryRes.ok) {
          const retryData = await retryRes.json();
          const retryText = (retryData.content as Array<{ type: string; text?: string }>)
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text)
            .join("")
            .trim();
          if (retryText) {
            try {
              const retryDecision = parseDecisionJson(retryText);
              const retryValidation = validateCommitCard(retryDecision);
              if (retryValidation.valid) {
                console.log("commitcard-guard: retry succeeded");
                return jsonResponse({
                  ...retryValidation.card,
                  _guard: { valid: true, autoFilled: retryValidation.autoFilled, retried: true },
                });
              }
            } catch {
              console.warn("commitcard-guard: retry produced invalid JSON");
            }
          }
        }
      }

      return jsonResponse({
        ...rawDecision,
        decision_found: false,
        _guard: { valid: false, issues: validation.issues },
      });
    }

    // Valid card — return with any auto-fill metadata
    return jsonResponse({
      ...validation.card,
      _guard: {
        valid: true,
        autoFilled: validation.autoFilled.length > 0 ? validation.autoFilled : undefined,
        retried: false,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("atlas-commit error:", msg);
    return jsonResponse({ error: msg }, 500);
  }
});
