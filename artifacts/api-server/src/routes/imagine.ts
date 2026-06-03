import { Router, type IRouter } from "express";
import { GoogleGenAI } from "@google/genai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type ImageStyle = "photorealistic" | "illustration" | "diagram" | "minimal";

interface ImagineBody {
  prompt: string;
  style?: ImageStyle;
  size?: "square" | "landscape" | "portrait";
}

function buildStyledPrompt(prompt: string, style?: ImageStyle): string {
  const styleMap: Record<ImageStyle, string> = {
    photorealistic: "Photorealistic, high quality, professional photography style.",
    illustration: "Clean digital illustration, modern flat design style, vibrant colors.",
    diagram: "Clean technical diagram, minimal design, white background, clear labels.",
    minimal: "Minimalist design, clean lines, simple composition, white space.",
  };
  const suffix = style ? ` ${styleMap[style]}` : "";
  return `${prompt}${suffix} High quality, professional, suitable for a modern product or website.`;
}

// POST /api/imagine — generate an image from a text prompt
// Primary: Gemini Imagen 3 (uses existing GOOGLE_GEMINI_API_KEY)
// Fallback: DALL·E 3 (requires OPENAI_API_KEY)
router.post("/imagine", async (req, res): Promise<void> => {
  const body = req.body as ImagineBody;
  const { prompt, style } = body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const styledPrompt = buildStyledPrompt(prompt.trim(), style);

  // Try Gemini Imagen 3 first
  const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateImages({
        model: "imagen-3.0-generate-004",
        prompt: styledPrompt,
        config: {
          numberOfImages: 1,
          outputMimeType: "image/jpeg",
          aspectRatio: body.size === "landscape" ? "16:9" : body.size === "portrait" ? "9:16" : "1:1",
        },
      });

      const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
      if (imageBytes) {
        const base64 = typeof imageBytes === "string"
          ? imageBytes
          : Buffer.from(imageBytes as Uint8Array).toString("base64");

        res.json({
          imageUrl: `data:image/jpeg;base64,${base64}`,
          prompt: styledPrompt,
          model: "imagen-3",
        });
        return;
      }
    } catch (err: unknown) {
      logger.warn({ err }, "Imagen 3 generation failed — trying DALL·E fallback");
    }
  }

  // Fallback: DALL·E 3
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: openaiKey });

      const sizeMap = { square: "1024x1024", landscape: "1792x1024", portrait: "1024x1792" } as const;
      const size = sizeMap[body.size ?? "square"];

      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: styledPrompt,
        n: 1,
        size,
        response_format: "b64_json",
      });

      const b64 = response.data?.[0]?.b64_json;
      if (b64) {
        res.json({
          imageUrl: `data:image/png;base64,${b64}`,
          prompt: response.data?.[0]?.revised_prompt ?? styledPrompt,
          model: "dall-e-3",
        });
        return;
      }
    } catch (err: unknown) {
      logger.error({ err }, "DALL·E 3 generation failed");
    }
  }

  res.status(503).json({
    error: "Image generation unavailable — no working image generation API key found",
  });
});

export default router;
