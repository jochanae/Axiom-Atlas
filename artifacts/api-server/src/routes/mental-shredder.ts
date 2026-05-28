import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const router = Router();

const ShredInput = z.object({
  thought: z.string().trim().min(3).max(2000),
});

const SYSTEM_PROMPT = `You are Atlas operating in MENTAL SHREDDER mode.

The user is dropping an anxious, noisy, or spiraling thought into a zero-trace sovereign session. Your job is NOT comfort, NOT validation, NOT therapy. Your job is to take the raw mental noise and return STRUCTURE.

Return exactly two things:

1. "reframe" — One or two crisp sentences that strip emotion and restate the thought as a structural observation a strategist would write. Name what is actually true vs assumed. No platitudes, no hedging. Plain, direct language. Max ~50 words.

2. "smallest_action" — ONE concrete next move the user can complete in under 10 minutes today. Verb-led. Specific. Not a project, not a habit — a singular bounded action. Max ~25 words.

Hard rules:
- Never refer to past sessions or memory. Each call is stateless.
- Never quote the user's thought back at them.
- Never moralize, never apologize, never use "just".
- Output ONLY valid JSON: {"reframe": "...", "smallest_action": "..."}. No prose, no markdown, no preface.`;

router.post("/mental-shredder", async (req, res): Promise<void> => {
  const parsed = ShredInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { thought } = parsed.data;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: thought }],
    });

    const text = message.content.find((b) => b.type === "text")?.text ?? "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const output = JSON.parse(clean) as { reframe?: string; smallest_action?: string };

    if (!output.reframe || !output.smallest_action) {
      res.status(502).json({ error: "Shredder returned malformed output" });
      return;
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Atlas-Sovereign", "zero-trace");

    res.status(200).json({
      reframe: output.reframe,
      smallest_action: output.smallest_action,
      original: thought,
    });
  } catch {
    res.status(500).json({ error: "Shredder failed" });
  }
});

export default router;
