// WhisperGate — Intent classifier layer.
// Classifies every user input into a mode before it reaches the executor.
//
// Modes:
//   THINK  — exploratory, conceptual, brainstorming, "what if", opinions
//   BUILD  — code generation, implementation, file creation, wiring, fixing
//   DECIDE — architectural choices, trade-off evaluation, commit-worthy decisions
//
// Returns the classified intent plus an optional validation note when input
// is ambiguous or malformed.

export type IntentMode = "THINK" | "BUILD" | "DECIDE";

export interface WhisperResult {
  mode: IntentMode;
  confidence: "high" | "medium" | "low";
  /** Optional note when input is ambiguous or needs refinement */
  refinement?: string;
}

const CLASSIFY_PROMPT = `You are an intent classifier for a sovereign build engine called Atlas.

Classify the user's message into exactly ONE mode:

THINK — The user is exploring, brainstorming, asking for opinions, discussing architecture conceptually, or asking "what if" questions. They are NOT requesting code or making a decision.

BUILD — The user wants something implemented, generated, fixed, wired up, or created. They expect code, components, schemas, configurations, or tangible artifacts as output.

DECIDE — The user is evaluating trade-offs, choosing between approaches, making an architectural commitment, or asking for a recommendation that should be recorded. The output should help them lock in a decision.

Respond with ONLY valid JSON, no markdown fences:
{"mode":"THINK|BUILD|DECIDE","confidence":"high|medium|low","refinement":"optional note if input is ambiguous"}

Rules:
- If the message contains explicit action verbs like "build", "create", "fix", "wire up", "implement", "add" → BUILD
- If the message asks "should I", "which is better", "what approach", "let's decide" → DECIDE
- If the message is conversational, exploratory, or asks for explanation → THINK
- If ambiguous between two modes, pick the dominant one and set confidence to "medium" or "low"
- "refinement" is null unless you genuinely cannot determine intent (confidence=low)`;

/**
 * Classify user intent using a fast, cheap AI call.
 * Falls back to THINK with low confidence on any failure.
 */
export async function classifyIntent(
  message: string,
  recentHistory?: Array<{ role: string; content: string }>,
): Promise<WhisperResult> {
  const fallback: WhisperResult = { mode: "THINK", confidence: "low", refinement: "Classification unavailable — defaulting to exploratory mode." };

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      console.warn("whisper-gate: LOVABLE_API_KEY not set, using keyword fallback");
      return keywordFallback(message);
    }

    // Include last 2 messages for context (keeps token count tiny)
    const contextMessages = (recentHistory ?? []).slice(-2).map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, 200),
    }));

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: CLASSIFY_PROMPT },
          ...contextMessages,
          { role: "user", content: message.slice(0, 500) },
        ],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      console.warn(`whisper-gate: AI gateway returned ${res.status}, using keyword fallback`);
      return keywordFallback(message);
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip markdown fences if model wraps anyway
    const jsonStr = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonStr);

    const mode = (["THINK", "BUILD", "DECIDE"] as const).includes(parsed.mode) ? parsed.mode : "THINK";
    const confidence = (["high", "medium", "low"] as const).includes(parsed.confidence) ? parsed.confidence : "medium";

    return {
      mode,
      confidence,
      refinement: parsed.refinement || undefined,
    };
  } catch (err) {
    console.error("whisper-gate: classification failed", err);
    return fallback;
  }
}

/** Cheap keyword-based fallback when AI is unavailable */
function keywordFallback(message: string): WhisperResult {
  const lower = message.toLowerCase();

  const buildSignals = ["build", "create", "implement", "fix", "wire", "add", "generate", "make", "code", "component", "deploy", "push", "ship"];
  const decideSignals = ["should i", "which is better", "decide", "choose", "trade-off", "tradeoff", "recommend", "commit to", "lock in", "approach"];

  const buildScore = buildSignals.filter(s => lower.includes(s)).length;
  const decideScore = decideSignals.filter(s => lower.includes(s)).length;

  if (buildScore > decideScore && buildScore > 0) return { mode: "BUILD", confidence: "medium" };
  if (decideScore > 0) return { mode: "DECIDE", confidence: "medium" };
  return { mode: "THINK", confidence: "medium" };
}
