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

// ── Engine: Gemini Imagen 3 (RENDER mode) ────────────────────────────────────

async function generateWithGemini(
  prompt: string,
  size: ImagineBody["size"] = "square"
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const aspectRatio = size === "landscape" ? "16:9" : size === "portrait" ? "9:16" : "1:1";

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateImages({
    model: "imagen-3.0-generate-004",
    prompt,
    config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio },
  });

  const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
  if (!imageBytes) return null;

  const base64 =
    typeof imageBytes === "string"
      ? imageBytes
      : Buffer.from(imageBytes as Uint8Array).toString("base64");

  return `data:image/jpeg;base64,${base64}`;
}

// ── Engine: DALL·E 3 (SCHEMATIC mode) ────────────────────────────────────────

async function generateWithDalle(
  prompt: string,
  size: ImagineBody["size"] = "square"
): Promise<{ url: string; revisedPrompt: string } | null> {
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
    size: sizeMap[size],
    response_format: "b64_json",
  });

  const item = response.data?.[0];
  if (!item?.b64_json) return null;

  return {
    url: `data:image/png;base64,${item.b64_json}`,
    revisedPrompt: item.revised_prompt ?? prompt,
  };
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
      const url = await generateWithGemini(enginePrompt, size);
      if (url) {
        images.push({ imageUrl: url, prompt: enginePrompt, model: "imagen-3", mode });
      }
    } catch (err) {
      logger.warn({ err }, "Imagen 3 failed for render mode — trying DALL·E fallback");
    }

    // Fallback: DALL·E 3
    if (images.length === 0) {
      try {
        const result = await generateWithDalle(enginePrompt, size);
        if (result) {
          images.push({ imageUrl: result.url, prompt: result.revisedPrompt, model: "dall-e-3", mode });
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
        images.push({ imageUrl: result.url, prompt: result.revisedPrompt, model: "dall-e-3", mode });
      }
    } catch (err) {
      logger.warn({ err }, "DALL·E 3 failed for schematic mode — trying Gemini fallback");
    }

    // Fallback: Gemini Imagen 3
    if (images.length === 0) {
      try {
        const url = await generateWithGemini(enginePrompt, size);
        if (url) {
          images.push({ imageUrl: url, prompt: enginePrompt, model: "imagen-3", mode });
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
