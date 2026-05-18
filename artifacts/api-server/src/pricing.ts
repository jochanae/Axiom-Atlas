export const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
  "gemini-2.0-flash-preview-image-generation": { inputPer1M: 0.1, outputPer1M: 0.4 },
};

export function calculateModelCostUsd(modelId: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing || inputTokens == null || outputTokens == null) return null;
  return ((inputTokens * pricing.inputPer1M) + (outputTokens * pricing.outputPer1M)) / 1_000_000;
}
