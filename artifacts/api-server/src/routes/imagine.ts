import { Router, type IRouter } from "express";
import { GoogleGenAI } from "@google/genai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

type ImageMode = "render" | "schematic";

interface ImagineBody {
  prompt: string;
  mode: ImageMode;
  size?: "square" | "landscape" | "portrait";
}

interface GeneratedImage {
  imageUrl: string;
  prompt: string;
  model: string;
  mode: ImageMode;
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildRenderPrompt(prompt: string): string {
  return `${prompt} Ultra-premium, cinematic quality. Sleek dark-mode aesthetic with obsidian depth, luxury glassmorphism elements, subtle amber/gold accent glows. Sophisticated editorial lighting, razor-sharp modern typography where relevant, presentation-ready professional finish. Hyper-realistic materials and subtle environmental light. 8K resolution output quality.`;
}

function buildSchematicPrompt(prompt: string): string {
  return `${prompt} Clean flat 2D technical diagram. High-contrast dark background with crisp white or bright accent lines. Strict geometric layout, precise spatial placement of every element. Clear directional connectors, sharp boundaries between sections, minimal decorative noise. Exact label placement, no atmospheric effects — pure structural accuracy and readability.`;
}

// ── Engine: Gemini Inline Image (RENDER + SCHEMATIC modes) ──────────────────
// Uses gemini-2.5-flash-image which supports both image and text output.
// This is the ONLY working image generation engine with the current API key.

async function generateWithGemini(
  prompt: string,
  _size: ImagineBody["size"] = "square"
): Promise<{ imageUrl: string; revisedPrompt: string } | null> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: prompt,
    config: { responseModalities: ["IMAGE", "TEXT"] },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
  const textPart = parts.find((p: any) => p.text);

  if (!imagePart?.inlineData?.data) return null;

  const mime = imagePart.inlineData.mimeType;
  const base64 = imagePart.inlineData.data;
  return {
    imageUrl: `data:${mime};base64,${base64}`,
    revisedPrompt: textPart?.text ?? prompt,
  };
}

// ── Engine: DALL·E 3 (SCHEMATIC mode fallback) ───────────────────────────────
// NOTE: DALL-E 3 is currently non-functional with the current key (model does not exist).
// Kept as a stub so we can re-enable when a proper OpenAI key is configured.

async function generateWithDalle(
  prompt: string,
  _size: ImagineBody["size"] = "square"
): Promise<{ imageUrl: string; revisedPrompt: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey });

  const sizeMap = {
    square: "1024x1024",
    landscape: "1792x1024",
    portrait: "1024x1792",
  } as const;

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt,
    n: 1,
    size: sizeMap[_size],
  });

  const item = response.data?.[0];
  if (!item?.url) return null;

  // Fetch the image from the URL and convert to base64
  try {
    const imgRes = await fetch(item.url, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) return { imageUrl: item.url, revisedPrompt: item.revised_prompt ?? prompt };
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    return {
      imageUrl: `data:image/png;base64,${buffer.toString("base64")}`,
      revisedPrompt: item.revised_prompt ?? prompt,
    };
  } catch {
    return { imageUrl: item.url, revisedPrompt: item.revised_prompt ?? prompt };
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

// POST /api/imagine
//
// Dual-engine image generation:
//   mode "render"    → Gemini Imagen 3 (premium cinematic, client-facing visuals)
//   mode "schematic" → DALL·E 3       (technical diagrams, architecture maps)
//
// Each mode has a fallback: if the primary engine fails or its key is missing,
// the other engine is tried automatically so generation is never silently lost.
//
// Returns: { images: GeneratedImage[] }
// Always an array — callers should expect 1 item (or 0 on total failure).

router.post("/imagine", async (req, res): Promise<void> => {
  const body = req.body as ImagineBody;
  const { prompt, mode, size } = body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }
  if (mode !== "render" && mode !== "schematic") {
    res.status(400).json({ error: "mode must be 'render' or 'schematic'" });
    return;
  }

  const trimmedPrompt = prompt.trim();
  const images: GeneratedImage[] = [];

  if (mode === "render") {
    // Primary: Gemini Imagen 3
    const enginePrompt = buildRenderPrompt(trimmedPrompt);
    try {
      const result = await generateWithGemini(enginePrompt, size);
      if (result) {
        images.push({ imageUrl: result.imageUrl, prompt: result.revisedPrompt, model: "gemini-flash-image", mode });
      }
    } catch (err) {
      logger.warn({ err }, "Gemini inline image failed for render mode — trying DALL·E fallback");
    }

    // Fallback: DALL·E 3
    if (images.length === 0) {
      try {
        const result = await generateWithDalle(enginePrompt, size);
        if (result) {
          images.push({ imageUrl: result.imageUrl, prompt: result.revisedPrompt, model: "dall-e-3", mode });
        }
      } catch (err) {
        logger.error({ err }, "DALL·E fallback also failed for render mode");
      }
    }
  } else {
    // mode === "schematic"
    // Primary: DALL·E 3
    const enginePrompt = buildSchematicPrompt(trimmedPrompt);
    try {
      const result = await generateWithDalle(enginePrompt, size);
      if (result) {
        images.push({ imageUrl: result.imageUrl, prompt: result.revisedPrompt, model: "dall-e-3", mode });
      }
    } catch (err) {
      logger.warn({ err }, "DALL·E 3 failed for schematic mode — trying Gemini fallback");
    }

    // Fallback: Gemini inline image
    if (images.length === 0) {
      try {
        const result = await generateWithGemini(enginePrompt, size);
        if (result) {
          images.push({ imageUrl: result.imageUrl, prompt: result.revisedPrompt, model: "gemini-flash-image", mode });
        }
      } catch (err) {
        logger.error({ err }, "Gemini fallback also failed for schematic mode");
      }
    }
  }

  if (images.length === 0) {
    res.status(503).json({
      error: "Image generation unavailable. For render mode: check GOOGLE_GEMINI_API_KEY. For schematic mode: check OPENAI_API_KEY.",
    });
    return;
  }

  res.json({ images });
});

export default router;
