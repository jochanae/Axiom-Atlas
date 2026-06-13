// Atlas chat edge function — proxies to Anthropic Claude with tool calling
// Creates workspace_nodes and recommendations on the user's behalf via service role.
// WhisperGate classifies every input as THINK/BUILD/DECIDE before execution.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { composeAtlasPrompt } from "../_shared/atlas-core.ts";
import { classifyIntent, type IntentMode, type WhisperResult } from "../_shared/whisper-gate.ts";
import { validateOutput } from "../_shared/output-guard.ts";
import { validateCommitCard } from "../_shared/commitcard-guard.ts";
import { parseAttachments, renderAttachmentContext, type Attachment, type ParsedAttachment } from "../_shared/parse-attachment.ts";
import { detectDecisionCatch, type DecisionCatchPayload } from "../_shared/decision-catch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Chat-specific extension. Voice, discipline, and card-tone normalization
// come from the shared core via composeAtlasPrompt(). Keep this focused on
// the conversational job: when to emit cards, the card schema, plan detection.
const ATLAS_CHAT_ROLE = `═══════════════════════════════════════════════════════════════
RESPONSE MODE — prose by default, cards when earned
═══════════════════════════════════════════════════════════════

Default to conversational, natural responses. Match the user's intent and energy. Only switch to structured CommitCard output when the response contains:
  - a clear architectural or strategic decision the user could commit
  - a structured plan with ordered phases, steps, or roadmap
  - a reusable artifact (a delivered build, a flagged blocker, a stub being shipped)

If you are chatting, asking a clarifying question, exploring an idea, or offering an opinion that isn't a deliverable, do NOT emit a card. Plain prose only. Cards must feel rare and important — earned, not default.

═══════════════════════════════════════════════════════════════
COMMIT CARDS — schema
═══════════════════════════════════════════════════════════════

When you DO have something committable, append a structured CommitCard at the END of your response inside a fenced block:

\`\`\`atlas-card
{
  "v": 1,
  "severity": "committed" | "parked" | "blocker" | "neutral",
  "verb": "new" | "bug" | "perf" | "note" | "wip" | "audit" | "merge" | "plan",
  "title": "Short title under 60 chars",
  "summary": "1-2 line plain-text summary of the deliverable.",
  "details": "Optional longer markdown for the Details drawer.",
  "touched": ["optional", "list", "of", "files-or-areas"]
}
\`\`\`

Severity rules:
- "committed" — a sound, audit-passed deliverable ready to lock in.
- "parked" — a stub or temporary fix; works, but flagged for revisit.
- "blocker" — a critical issue that must be resolved before progress.
- "neutral" — a notable note worth recording but not a decision.

Verb rules: "new" for features, "bug" for defects, "perf" for speed, "note" for documentation/ledger entries, "wip" for stubs, "audit" for verification, "merge" for agreements/syntheses, "plan" for ordered phases or roadmaps.

═══════════════════════════════════════════════════════════════
PLAN DETECTION
═══════════════════════════════════════════════════════════════

If your response contains 3 or more clearly ordered steps, numbered phases, or explicit roadmap language ("Phase 1", "Step 1", "First...Then...Finally"), emit a CommitCard with verb="plan" and severity="parked" (plans start unresolved). The "details" field should hold the structured plan as markdown. The prose above the card stays conversational.

For weaker structure (loose bullet lists, soft ordering), do NOT auto-emit. Let the user promote it manually.`;

const SYSTEM_PROMPT = composeAtlasPrompt(ATLAS_CHAT_ROLE);

type ActiveLedgerEntry = {
  id: string;
  title: string;
  description: string | null;
};

function buildGuardedSystemPrompt(entries: ActiveLedgerEntry[]) {
  if (entries.length === 0) return SYSTEM_PROMPT;

  const committedDecisions = entries
    .map(
      (entry) =>
        `- "${entry.title}"${entry.description ? ` — ${entry.description}` : ""}`,
    )
    .join("\n");

  return `═══════════════════════════════════════════════════════════════
DECISION CATCH — pre-flight check against committed decisions
═══════════════════════════════════════════════════════════════

These are locked decisions this person has already made on this venture. They are the substrate. Before you respond to anything, scan the user's message against this list and ask one question silently: "Does what they're about to do contradict, override, or quietly drift from anything below?"

Active committed decisions:
${committedDecisions}

If the answer is YES — you've caught a real conflict, drift, or contradiction — STOP. Do not answer the original request. Instead, respond like a thinking partner who just noticed something. Plain prose. Warm but direct. The shape is:

  Before you do — this pulls against [the specific decision, named exactly as titled above]. [One sentence on what the tension is.] Want to proceed anyway, update the decision, or rethink the move?

That's it. No "CONFLICT_DETECTED:". No bullet menu of options 1/2/3. No headers. It should read like one breath from someone who's been holding the thread for them. Name the committed decision in quotes so the UI can surface it.

If the answer is NO — there's no real contradiction, just a related topic — proceed normally. Never mention the check. Never preface with "I checked the ledger." The catch is invisible until it fires.

Be honest about ambiguity. If a request only loosely brushes against a decision, that is NOT a catch. Cheap pattern-matching kills the whole point. The bar is: "if they do this, will it cost them later." If yes, catch it. If no, stay quiet.

═══════════════════════════════════════════════════════════════

${SYSTEM_PROMPT}`;
}

const tools = [
  {
    name: "create_node",
    description:
      "Create a workspace node (a file/draft/note) that becomes visible in the user's Workspace panel. Use this whenever you produce content the user should see and keep.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["note", "draft"],
          description: "note = short reference; draft = in-progress work",
        },
        title: { type: "string", description: "Short title (under 60 chars)" },
        body: {
          type: "string",
          description: "Markdown/plain text body of the node",
        },
      },
      required: ["type", "title", "body"],
    },
  },
  {
    name: "create_recommendation",
    description:
      "Surface a structural suggestion that should be logged permanently. Use sparingly — only for ideas worth tracking.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The suggestion itself" },
        definition: {
          type: "string",
          description: "Plain-language explanation of what this is",
        },
        benefit: {
          type: "string",
          description: "Why this matters to the builder",
        },
        priority: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["content", "definition", "benefit", "priority"],
    },
  },
];

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

    const { sessionId, projectId, message, history, attachments } = await req.json() as {
      sessionId?: string;
      projectId?: string;
      message?: string;
      history?: Array<{ role: string; content: string }>;
      attachments?: Attachment[];
    };
    if (!sessionId || !projectId || !message)
      throw new Error("sessionId, projectId, message required");

    // ═══ Parse attachments — turn uploaded files into model context ═══
    let parsedAttachments: ParsedAttachment[] = [];
    let attachmentContext: string | null = null;
    let imageAttachments: ParsedAttachment[] = [];
    let archiveNames: string[] = [];
    if (attachments && attachments.length > 0) {
      try {
        parsedAttachments = await parseAttachments(attachments);
        attachmentContext = renderAttachmentContext(parsedAttachments);
        imageAttachments = parsedAttachments.filter((p) => p.imageUrl);
        archiveNames = (attachments ?? [])
          .filter((a) => /\.(zip|tar|tgz|gz|rar|7z)$/i.test(a.name) || /zip|x-tar|gzip|x-rar|x-7z/i.test(a.type ?? ""))
          .map((a) => a.name);
        console.log(`atlas-chat: parsed ${parsedAttachments.length} attachments, ${imageAttachments.length} images, ${archiveNames.length} archives`);
      } catch (err) {
        console.error("atlas-chat: attachment parsing failed", err);
      }
    }

    // Conflict guard: pull committed entries (Ledger view) from the
    // unified `entries` table. Same object as Parking Lot, filtered by
    // status='committed'.
    const entriesAny = userClient.from(
      "entries" as unknown as Parameters<typeof userClient.from>[0],
    ) as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => {
          eq: (col: string, val: unknown) => {
            eq: (col: string, val: unknown) => {
              order: (col: string, opts: { ascending: boolean }) => {
                limit: (n: number) => Promise<{
                  data: Array<{ id: string; title: string; summary: string | null; created_at: string }> | null;
                  error: Error | null;
                }>;
              };
            };
          };
        };
      };
    };

    const { data: activeLedgerEntries, error: ledgerErr } = await entriesAny
      .select("id, title, summary, created_at")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .eq("status", "committed")
      .order("created_at", { ascending: false })
      .limit(10);
    if (ledgerErr) throw ledgerErr;

    const ledgerRows = activeLedgerEntries ?? [];
    const guardedSystemPrompt = buildGuardedSystemPrompt(
      ledgerRows.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.summary,
      })),
    );

    // Memory surfacing — pick the entries most relevant to this turn so
    // the UI can render tappable "Remembered from..." chips above the reply.
    // Cheap keyword-overlap heuristic; good enough until we add embeddings.
    const STOPWORDS = new Set([
      "the","a","an","and","or","but","if","then","of","to","in","on","for",
      "with","is","are","was","were","be","been","being","this","that","it",
      "as","by","at","from","i","you","we","they","my","your","our","their",
      "do","does","did","have","has","had","not","no","can","could","should",
      "would","what","why","how","when","where","which","who","so","just","up",
      "down","out","about","over","under","into","than","too","very","also",
    ]);
    const tokenize = (s: string) =>
      new Set(
        (s ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
      );
    const messageTokens = tokenize(message);
    const surfacedMemories = ledgerRows
      .map((e) => {
        const entryTokens = tokenize(`${e.title} ${e.summary ?? ""}`);
        let score = 0;
        for (const t of messageTokens) if (entryTokens.has(t)) score += 1;
        return { entry: e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => ({
        id: x.entry.id,
        title: x.entry.title,
        created_at: x.entry.created_at,
      }));


    // Persist the user message — prepend an archive marker when applicable
    // so the client can render the assistant's reply as a decision-first card.
    const archiveMarker = archiveNames.length > 0
      ? `[ARCHIVE ATTACHED: ${archiveNames.join(", ")}]\n`
      : "";
    await userClient.from("chat_messages").insert({
      session_id: sessionId,
      user_id: user.id,
      role: "user",
      content: `${archiveMarker}${message}`,
    });

    const { data: currentSession, error: sessionErr } = await userClient
      .from("sessions")
      .select("title")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (sessionErr) throw sessionErr;

    if (!currentSession?.title || currentSession.title === "Session") {
      const { error: titleErr } = await userClient
        .from("sessions")
        .update({ title: message.slice(0, 60) })
        .eq("id", sessionId)
        .eq("user_id", user.id);
      if (titleErr) throw titleErr;
    }

    // ═══ WhisperGate — classify intent before execution ═══
    const whisperResult: WhisperResult = await classifyIntent(message, history);
    console.log(`whisper-gate: mode=${whisperResult.mode} confidence=${whisperResult.confidence}`);

    const MODE_DIRECTIVES: Record<IntentMode, string> = {
      THINK: `MODE: THINK — The user is exploring or brainstorming. Respond conversationally. Do NOT generate code or structured plans unless explicitly asked. Focus on ideas, trade-offs, and clarifying questions. No CommitCards unless the conversation naturally arrives at a decision.`,
      BUILD: `MODE: BUILD — The user wants something implemented. Prioritize actionable output: code, schemas, configurations, wiring. Be concrete and specific. Use tool calls (create_node) when producing artifacts. Minimize preamble — get to the deliverable.`,
      DECIDE: `MODE: DECIDE — The user is evaluating options or making a commitment. Present clear trade-offs with pros/cons. End with a concrete recommendation. If the decision is significant, emit a CommitCard with the recommendation so it can be locked into the Ledger.`,
    };

    const modeDirective = MODE_DIRECTIVES[whisperResult.mode];
    const whisperPrefix = whisperResult.confidence === "low" && whisperResult.refinement
      ? `${modeDirective}\n\nNOTE: Intent classification was low-confidence. The user's input may be ambiguous. If unsure what they want, ask one clarifying question before proceeding.`
      : modeDirective;

    // Compose final system prompt: guarded decisions + mode directive
    const archiveDirective = archiveNames.length > 0
      ? `\n\nARCHIVE INGESTION MODE — the operator uploaded an archive (${archiveNames.join(", ")}). This is Context Ingestion, NOT a build request. Respond as a decision-first summary using EXACTLY these four sections, in this order, as level-3 markdown headings:\n\n### Uploaded\nWhat's in the archive — top-level structure, key files, scope.\n\n### Touches\nWhich committed Ledger entries this archive intersects with (cite by title). If none, say so.\n\n### Drift\nDetected conflicts, drift, or alignment issues against the committed direction. Be specific.\n\n### Question\nOne closing question that moves toward "what are we committing to?"\n\nDo NOT echo file contents as code blocks. Do NOT generate replacement code. The deliverable is clarity about decisions, not pages-to-drop-in.`
      : "";
    const finalSystemPrompt = `${guardedSystemPrompt}\n\n${whisperPrefix}${archiveDirective}`;

    // Build the user turn — append parsed text from attachments and add image
    // blocks for any uploaded images so Claude can actually see them.
    const userTextContent = attachmentContext
      ? `${message}${attachmentContext}`
      : message;

    type ContentBlock =
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "url"; url: string } };

    const userContent: ContentBlock[] = [{ type: "text", text: userTextContent }];
    for (const img of imageAttachments) {
      if (img.imageUrl) {
        userContent.push({ type: "image", source: { type: "url", url: img.imageUrl } });
      }
    }

    const messages = [
      ...(history ?? []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      {
        role: "user",
        content: imageAttachments.length > 0 ? userContent : userTextContent,
      },
    ];

    // Loop on tool use until Claude stops.
    let finalText = "";
    const createdNodes: Array<{ id: string; title: string; type: string }> = [];
    const createdRecs: Array<{ id: string; content: string }> = [];

    let workingMessages = [...messages];
    let safety = 0;
    // Decision Catch gate — once a tension is detected in any Claude turn,
    // we stop tool execution entirely. Per POSITIONING.md §3.4, a caught
    // tension means EVERYTHING pauses (codegen, card extraction, workspace
    // node creation) until the user explicitly chooses Proceed or Adjust.
    const ledgerRefs = ledgerRows.map((e) => ({ id: e.id, title: e.title }));
    let earlyCatch: DecisionCatchPayload | null = null;

    while (safety < 5) {
      safety++;
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          system: finalSystemPrompt,
          tools,
          messages: workingMessages,
        }),
      });

      if (!claudeRes.ok) {
        const t = await claudeRes.text();
        console.error("Claude error", claudeRes.status, t);
        return new Response(
          JSON.stringify({ error: `Claude API error: ${claudeRes.status}` }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const data = await claudeRes.json();
      const content = data.content as Array<
        | { type: "text"; text: string }
        | {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
          }
      >;

      // Collect text
      for (const block of content) {
        if (block.type === "text") finalText += (finalText ? "\n\n" : "") + block.text;
      }

      const toolUses = content.filter(
        (b): b is Extract<typeof content[number], { type: "tool_use" }> =>
          b.type === "tool_use",
      );

      if (toolUses.length === 0 || data.stop_reason !== "tool_use") break;

      // Decision Catch gate — if Atlas opened with "Before you do —" and the
      // quoted decision resolves to a committed entry, suppress ALL tool
      // calls in this response. No workspace nodes, no recommendations.
      // The chat handler will also skip card extraction below.
      earlyCatch = detectDecisionCatch(finalText, ledgerRefs);
      if (earlyCatch) {
        console.log(`decision-catch: gate engaged — suppressing ${toolUses.length} tool call(s) against entry ${earlyCatch.against.id}`);
        break;
      }

      // Execute tools, collect tool_results
      const toolResults: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
      }> = [];

      for (const tu of toolUses) {
        try {
          if (tu.name === "create_node") {
            const input = tu.input as { type: string; title: string; body: string };
            const { data: node, error } = await userClient
              .from("workspace_nodes")
              .insert({
                user_id: user.id,
                project_id: projectId,
                session_id: sessionId,
                type: input.type,
                title: input.title,
                content: { body: input.body },
                status: "active",
              })
              .select("id, title, type")
              .single();
            if (error) throw error;
            createdNodes.push(node);
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: `Created node ${node.id} (${node.type}: ${node.title}).`,
            });
          } else if (tu.name === "create_recommendation") {
            const input = tu.input as {
              content: string;
              definition: string;
              benefit: string;
              priority: string;
            };
            const { data: rec, error } = await userClient
              .from("recommendations")
              .insert({
                user_id: user.id,
                project_id: projectId,
                session_id: sessionId,
                content: input.content,
                definition: input.definition,
                benefit: input.benefit,
                priority: input.priority,
                status: "pending",
              })
              .select("id, content")
              .single();
            if (error) throw error;
            createdRecs.push(rec);
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: `Recommendation logged ${rec.id}.`,
            });
          } else {
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: `Unknown tool: ${tu.name}`,
            });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "tool failed";
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Error: ${msg}`,
          });
        }
      }

      // Append assistant turn + tool results, loop.
      workingMessages = [
        ...workingMessages,
        { role: "assistant", content },
        { role: "user", content: toolResults },
      ];
    }

    if (!finalText.trim())
      finalText = "Done.";

    // ═══ Output Guard — mode-specific validation with single retry ═══
    const validation = validateOutput(finalText, whisperResult.mode);
    let outputRepaired = false;

    if (!validation.valid && validation.correction) {
      console.warn(`output-guard: violation="${validation.violation}" mode=${whisperResult.mode} — attempting retry`);

      // Single retry: inject the correction as a follow-up user turn
      const retryMessages = [
        ...workingMessages,
        { role: "assistant", content: [{ type: "text", text: finalText }] },
        {
          role: "user",
          content: `[SYSTEM — OUTPUT VALIDATION FAILED]\nViolation: ${validation.violation}\n\n${validation.correction}\n\nRewrite your previous response to fix this. Do not acknowledge this system message — just produce the corrected output.`,
        },
      ];

      try {
        const retryRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1500,
            system: finalSystemPrompt,
            messages: retryMessages,
          }),
        });

        if (retryRes.ok) {
          const retryData = await retryRes.json();
          const retryContent = retryData.content as Array<{ type: string; text?: string }>;
          const retryText = retryContent
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("\n\n");

          if (retryText.trim()) {
            // Validate the retry output too — but don't loop again
            const retryValidation = validateOutput(retryText, whisperResult.mode);
            if (retryValidation.valid) {
              finalText = retryText;
              outputRepaired = true;
              console.log("output-guard: retry succeeded, output repaired");
            } else {
              console.warn(`output-guard: retry still invalid (${retryValidation.violation}), using original`);
            }
          }
        }
      } catch (retryErr) {
        console.error("output-guard: retry call failed", retryErr);
      }
    }

    // ═══ Decision Catch — extract structured catch from prose, if any ═══
    // The system prompt requires "Before you do — …" + quoted decision title
    // when Atlas catches a real conflict. We parse that and resolve the
    // quoted title to a committed entry so the UI can render DecisionCatchCard.
    // Reuse earlyCatch if the in-loop gate already fired so we don't re-parse.
    const decisionCatch: DecisionCatchPayload | null =
      earlyCatch ?? detectDecisionCatch(finalText, ledgerRefs);
    if (decisionCatch) {
      console.log(`decision-catch: fired against entry ${decisionCatch.against.id} ("${decisionCatch.against.title}")`);
    }

    // Decision Catch gate (post-loop): when a tension is caught, suppress
    // CommitCard extraction. Nothing lands in the Ledger until the user
    // explicitly chooses Proceed (logs a deviation) or Adjust (reframes).
    let cardPayload: Record<string, unknown> | null = null;
    let cardSchemaVersion: number | null = null;
    if (!decisionCatch) {
      const fenceMatch = finalText.match(/```atlas-card\s*([\s\S]*?)```/);
      if (fenceMatch) {
        try {
          const parsed = JSON.parse(fenceMatch[1]) as Record<string, unknown>;
          const cardValidation = validateCommitCard(parsed as any);
          if (cardValidation.valid) {
            cardPayload = cardValidation.card as Record<string, unknown>;
            cardSchemaVersion = (cardValidation.card.v as number) ?? 1;
            if (cardValidation.autoFilled.length > 0) {
              console.log(`commitcard-guard (inline): auto-filled ${cardValidation.autoFilled.join(", ")}`);
            }
          } else {
            console.warn(`commitcard-guard (inline): rejected card — ${cardValidation.issues.join(", ")}`);
          }
        } catch (err) {
          console.warn("atlas-chat: failed to parse atlas-card block", err);
        }
      }
    } else {
      console.log("decision-catch: gate engaged — skipping CommitCard extraction");
    }

    const memoriesForMessage = surfacedMemories.length > 0 ? surfacedMemories : null;

    const { data: insertedMessage, error: insertError } = await userClient
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        user_id: user.id,
        role: "assistant",
        content: finalText,
        intent_type: whisperResult.mode,
        card_payload: cardPayload,
        card_schema_version: cardSchemaVersion,
        surfaced_memories: memoriesForMessage,
        decision_catch: decisionCatch,
        output_guard_violation: validation.valid ? null : (validation.violation ?? null),
        output_guard_repaired: outputRepaired,
      })
      .select("*")
      .single();
    if (insertError) throw insertError;

    // ═══ Phase 4: Observability — auto-log notable state transitions ═══
    // Decision Catch gate: when a tension is caught, do NOT write the audit
    // entry either. The Ledger stays untouched until the user resolves.
    const hasNotableEvent = !validation.valid || outputRepaired || whisperResult.confidence === "low";
    if (hasNotableEvent && !decisionCatch) {
      const parts: string[] = [];
      parts.push(`Intent: ${whisperResult.mode} (${whisperResult.confidence})`);
      if (!validation.valid) parts.push(`Guard violation: ${validation.violation}`);
      if (outputRepaired) parts.push("Auto-repaired via retry");
      if (whisperResult.refinement) parts.push(`Refinement: ${whisperResult.refinement}`);

      try {
        await userClient.from("entries").insert({
          user_id: user.id,
          project_id: projectId,
          session_id: sessionId,
          status: "committed",
          severity: "neutral",
          verb: "audit",
          title: outputRepaired
            ? `Self-healed: ${validation.violation ?? "output issue"}`
            : !validation.valid
              ? `Guard flagged: ${validation.violation}`
              : `Low-confidence intent: ${whisperResult.mode}`,
          summary: parts.join(" · "),
          source_message_id: insertedMessage.id,
        });
      } catch (obsErr) {
        // Non-critical — don't break the response
        console.warn("observability log failed:", obsErr);
      }
    }

    return new Response(
      JSON.stringify({
        reply: finalText,
        message: insertedMessage,
        createdNodes,
        createdRecs,
        card: cardPayload,
        cardSchemaVersion,
        surfacedMemories,
        decisionCatch,
        intent: {
          mode: whisperResult.mode,
          confidence: whisperResult.confidence,
          refinement: whisperResult.refinement ?? null,
        },
        outputGuard: {
          valid: validation.valid,
          violation: validation.violation ?? null,
          repaired: outputRepaired,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("atlas-chat error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
