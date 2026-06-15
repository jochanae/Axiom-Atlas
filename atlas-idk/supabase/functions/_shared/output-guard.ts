// Output Guard — mode-specific validation for Atlas responses.
// Checks that the output matches the classified intent mode.
// Returns a diagnosis when validation fails so the retry loop
// can inject a correction prompt.

import type { IntentMode } from "./whisper-gate.ts";

export interface ValidationResult {
  valid: boolean;
  /** Which check failed */
  violation?: string;
  /** Correction prompt to inject for a single retry */
  correction?: string;
}

// ── Placeholder / filler patterns ──────────────────────────
const PLACEHOLDER_PATTERNS = [
  /\/\/ ?\.\.\./,                          // "// ..."
  /TODO/i,                                  // TODO markers
  /FIXME/i,                                 // FIXME markers
  /\[insert .+? here\]/i,                   // "[insert X here]"
  /your[- ]?(?:api[- ]?key|token|secret)/i, // "your-api-key"
  /placeholder/i,                           // explicit "placeholder"
  /lorem ipsum/i,                           // dummy text
];

const FILLER_PATTERNS = [
  /as (?:a|an) (?:large )?language model/i,
  /I (?:cannot|can't|am not able to) (?:write|generate|create|produce|build|implement)(?:\s+\w+){0,4}\b/i,
  /I'm just an AI/i,
  /here(?:'s| is) (?:a |an )?(?:general |basic )?(?:outline|overview|summary) (?:of )?(?:what|how)/i,
];

const RAMBLE_WORD_THRESHOLD = 800;
const SHORT_RESPONSE_THRESHOLD = 30; // chars

// ── Mode-specific validators ───────────────────────────────

function validateBuild(text: string): ValidationResult {
  // BUILD mode: should contain actionable artifacts, not just prose

  // Check for capability denial
  for (const pattern of FILLER_PATTERNS) {
    if (pattern.test(text)) {
      return {
        valid: false,
        violation: "capability_denial",
        correction: "You denied your capabilities or produced filler instead of a deliverable. You are a Sovereign IDE — generate the actual code, schema, or artifact the user asked for. No disclaimers. No outlines. Ship the thing.",
      };
    }
  }

  // Check for placeholder code
  const codeBlocks = text.match(/```[\s\S]*?```/g) ?? [];
  for (const block of codeBlocks) {
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(block)) {
        return {
          valid: false,
          violation: "placeholder_in_code",
          correction: "Your code contains placeholders (TODO, '...', '[insert here]'). Replace every placeholder with real, working implementation. Ship complete code — not stubs.",
        };
      }
    }
  }

  // BUILD should ideally produce *something* concrete — warn if purely conversational
  const hasCodeBlock = /```/.test(text);
  const hasToolCall = false; // tool calls are handled separately in the loop
  if (!hasCodeBlock && !hasToolCall && text.length > 200) {
    // Long BUILD response with no code — might be rambling
    const wordCount = text.split(/\s+/).length;
    if (wordCount > RAMBLE_WORD_THRESHOLD) {
      return {
        valid: false,
        violation: "build_without_artifact",
        correction: "The user asked you to BUILD something, but you wrote a long prose response with no code or artifact. Generate the actual implementation. If you need to explain, keep it under 3 sentences, then deliver the code.",
      };
    }
  }

  return { valid: true };
}

function validateThink(text: string): ValidationResult {
  // THINK mode: should be exploratory, conversational — not overly structured

  // Check for premature structure (cards emitted when just chatting)
  const hasCard = /```atlas-card/.test(text);
  if (hasCard) {
    // Cards in THINK mode are allowed only if genuinely earned
    // We flag but don't hard-fail — the card schema check downstream decides
  }

  // Check for rambling
  const wordCount = text.split(/\s+/).length;
  if (wordCount > RAMBLE_WORD_THRESHOLD) {
    return {
      valid: false,
      violation: "think_rambling",
      correction: "You're in exploratory mode but wrote a wall of text. Keep THINK responses tight — one idea per turn, under 200 words. If the user needs depth, they'll ask.",
    };
  }

  // Check for empty/useless response
  if (text.trim().length < SHORT_RESPONSE_THRESHOLD && text.trim() !== "Done.") {
    return {
      valid: false,
      violation: "empty_response",
      correction: "Your response is too short to be useful. Even in exploratory mode, provide a substantive thought, question, or direction.",
    };
  }

  return { valid: true };
}

function validateDecide(text: string): ValidationResult {
  // DECIDE mode: should present trade-offs and a recommendation

  // Check for capability denial
  for (const pattern of FILLER_PATTERNS) {
    if (pattern.test(text)) {
      return {
        valid: false,
        violation: "capability_denial",
        correction: "You denied your capabilities instead of helping the user make a decision. Present the trade-offs clearly and give a concrete recommendation.",
      };
    }
  }

  // DECIDE responses should have some structure — at minimum, options or a recommendation
  const hasTradeoff = /(?:trade-?off|pro|con|option|approach|alternative|advantage|disadvantage|versus|vs\.?)/i.test(text);
  const hasRecommendation = /(?:recommend|suggest|go with|best (?:option|approach|choice)|pick|choose|my take|lean toward)/i.test(text);

  if (!hasTradeoff && !hasRecommendation && text.length > 100) {
    return {
      valid: false,
      violation: "decide_no_tradeoffs",
      correction: "The user is trying to DECIDE. Present clear options with trade-offs (what you gain, what you lose). End with a concrete recommendation. Don't just describe — help them choose.",
    };
  }

  // Check for rambling
  const wordCount = text.split(/\s+/).length;
  if (wordCount > RAMBLE_WORD_THRESHOLD) {
    return {
      valid: false,
      violation: "decide_rambling",
      correction: "Your decision analysis is too long. Keep it tight: state the options, key trade-offs, and your recommendation. Under 300 words.",
    };
  }

  return { valid: true };
}

// ── Main entry point ───────────────────────────────────────

/**
 * Validate an Atlas response against the classified intent mode.
 * Returns { valid: true } or a diagnosis with a correction prompt
 * that can be injected for a single retry.
 */
export function validateOutput(text: string, mode: IntentMode): ValidationResult {
  if (!text || text.trim() === "Done.") return { valid: true };

  switch (mode) {
    case "BUILD":
      return validateBuild(text);
    case "THINK":
      return validateThink(text);
    case "DECIDE":
      return validateDecide(text);
    default:
      return { valid: true };
  }
}
