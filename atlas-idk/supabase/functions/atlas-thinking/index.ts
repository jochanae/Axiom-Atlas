// atlas-thinking — §XI Phase 3 "What Should I Be Thinking About Now"
// Reads compass + recent ledger + open parked items, generates 1–3
// anticipatory questions via Lovable AI, persists them as recommendations
// with kind='thinking_prompt'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { composeAtlasPrompt } from "../_shared/atlas-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  projectId: string;
  sessionId?: string;
}

interface Prompt {
  question: string;
  why_now: string;
  payoff: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user)
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const { projectId, sessionId }: Body = await req.json();
    if (!projectId)
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // Gather context (RLS-scoped via userClient).
    // Ledger and Parking Lot are now the same `entries` table; the only
    // difference is `status`. We split into two queries here purely for
    // the prompt template.
    const entriesAny = userClient.from(
      "entries" as unknown as Parameters<typeof userClient.from>[0],
    ) as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => {
          eq: (col: string, val: unknown) => {
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: unknown[] | null }>;
            };
          };
          order: (col: string, opts: { ascending: boolean }) => {
            limit: (n: number) => Promise<{ data: unknown[] | null }>;
          };
        };
      };
    };

    const [compassRes, ledgerRes, parkedRes, existingRes] = await Promise.all([
      userClient
        .from("project_compass")
        .select("compass_md, audience, aesthetics, seed_material")
        .eq("project_id", projectId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      entriesAny
        .select("title, summary, severity, verb, is_violation, created_at")
        .eq("project_id", projectId)
        .eq("status", "committed")
        .order("created_at", { ascending: false })
        .limit(8),
      entriesAny
        .select("title, summary, verb")
        .eq("project_id", projectId)
        .eq("status", "parked")
        .order("created_at", { ascending: false })
        .limit(10),
      userClient
        .from("recommendations")
        .select("content")
        .eq("project_id", projectId)
        .eq("kind", "thinking_prompt"),
    ]);

    const compass = compassRes.data;
    const ledger = (ledgerRes.data ?? []) as Array<{
      title: string;
      summary: string | null;
      is_violation: boolean;
    }>;
    const parked = (parkedRes.data ?? []) as Array<{
      title: string;
      summary: string | null;
      verb: string | null;
    }>;
    const previouslyAsked = (existingRes.data ?? [])
      .map((r: { content: string }) => r.content)
      .slice(0, 30);

    // If there's literally nothing yet, don't generate noise
    if (!compass && ledger.length === 0 && parked.length === 0) {
      return new Response(
        JSON.stringify({ prompts: [], reason: "insufficient_context" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = composeAtlasPrompt(`═══════════════════════════════════════════════════════════════
ROLE — "What Should I Be Thinking About Now"
═══════════════════════════════════════════════════════════════

This call is the §XI Mentor Layer primitive. Given a project's compass (governing intent), recent decisions on the architectural ledger, and open parked items, surface 1 to 3 ANTICIPATORY questions the builder probably hasn't asked themselves yet but should before their next decision.

Constraints:
- Questions must be specific to THIS project's context. No generic advice.
- Each question targets a real gap, tension, or unspoken assumption visible in the data.
- "why_now" cites the specific ledger entry, parked item, or compass section that triggered it.
- "payoff" describes what becomes clearer or safer if they answer it.
- Do NOT repeat or paraphrase any question in the "previously_asked" list. Discipline rule §1 (never ask twice) applies absolutely here.
- If there is nothing meaningful and new to surface, return an empty array. Silence is honorable.
- Tone: quiet, precise, no hype, no exclamation marks.`);

    const userPrompt = `<compass>
${compass?.compass_md ?? "(no compass yet)"}
${compass ? `\nAudience: ${compass.audience ?? "—"}\nAesthetics: ${compass.aesthetics ?? "—"}\nSeed: ${compass.seed_material ?? "—"}` : ""}
</compass>

<recent_ledger>
${
  ledger.length === 0
    ? "(empty)"
    : ledger
        .map(
          (l) =>
            `- [committed${l.is_violation ? " · VIOLATION" : ""}] ${l.title}${l.summary ? `: ${l.summary}` : ""}`,
        )
        .join("\n")
}
</recent_ledger>

<open_parked_items>
${
  parked.length === 0
    ? "(none)"
    : parked
        .map(
          (p) =>
            `- (${p.verb ?? "note"}) ${p.title}${p.summary ? ` — ${p.summary}` : ""}`,
        )
        .join("\n")
}
</open_parked_items>

<previously_asked>
${previouslyAsked.length === 0 ? "(none)" : previouslyAsked.map((q) => `- ${q}`).join("\n")}
</previously_asked>`;

    const aiRes = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "surface_thinking_prompts",
                description:
                  "Return 0-3 anticipatory questions the builder should consider next.",
                parameters: {
                  type: "object",
                  properties: {
                    prompts: {
                      type: "array",
                      maxItems: 3,
                      items: {
                        type: "object",
                        properties: {
                          question: { type: "string" },
                          why_now: { type: "string" },
                          payoff: { type: "string" },
                        },
                        required: ["question", "why_now", "payoff"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["prompts"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "surface_thinking_prompts" },
          },
        }),
      },
    );

    if (!aiRes.ok) {
      if (aiRes.status === 429)
        return new Response(
          JSON.stringify({ error: "Rate limit — try again shortly." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      if (aiRes.status === 402)
        return new Response(
          JSON.stringify({
            error: "AI credits exhausted. Add funds in workspace settings.",
          }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      const t = await aiRes.text();
      console.error("AI gateway error", aiRes.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall?.function?.arguments
      ? JSON.parse(toolCall.function.arguments)
      : { prompts: [] };
    const prompts: Prompt[] = Array.isArray(args.prompts) ? args.prompts : [];

    if (prompts.length === 0) {
      return new Response(JSON.stringify({ prompts: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Replace prior pending thinking prompts for this project (keep history minimal)
    await userClient
      .from("recommendations")
      .update({ status: "superseded" })
      .eq("project_id", projectId)
      .eq("kind", "thinking_prompt")
      .eq("status", "pending");

    const rows = prompts.map((p) => ({
      user_id: user.id,
      project_id: projectId,
      session_id: sessionId ?? null,
      kind: "thinking_prompt",
      status: "pending",
      priority: "medium",
      content: p.question,
      definition: p.why_now,
      benefit: p.payoff,
    }));

    const { data: inserted, error: insertErr } = await userClient
      .from("recommendations")
      .insert(rows)
      .select();
    if (insertErr) {
      console.error("insert error", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ prompts: inserted ?? rows }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("atlas-thinking error", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
