import { Router, type IRouter } from "express";
import { GoogleGenAI } from "@google/genai";

const router: IRouter = Router();

async function generateWithImagen(prompt: string): Promise<{ b64_json: string; mimeType: string } | null> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateImages({
    model: "imagen-3.0-generate-004",
    prompt,
    config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio: "1:1" },
  });

  const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
  if (!imageBytes) return null;

  const b64_json =
    typeof imageBytes === "string"
      ? imageBytes
      : Buffer.from(imageBytes as Uint8Array).toString("base64");

  return { b64_json, mimeType: "image/jpeg" };
}

async function generateWithGeminiFlash(prompt: string): Promise<{ b64_json: string; mimeType: string } | null> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-image-generation",
    contents: prompt,
    config: { responseModalities: ["IMAGE", "TEXT"] },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
  if (!imagePart?.inlineData) return null;

  return {
    b64_json: imagePart.inlineData.data as string,
    mimeType: imagePart.inlineData.mimeType as string,
  };
}

router.post("/image/generate", async (req, res): Promise<void> => {
  const { prompt } = req.body as { prompt?: string };
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing prompt" });
    return;
  }

  try {
    const result =
      (await generateWithImagen(prompt)) ??
      (await generateWithGeminiFlash(prompt));

    if (!result) {
      res.status(500).json({ error: "No image returned — both engines failed or GOOGLE_GEMINI_API_KEY is not set" });
      return;
    }

    res.json({
      b64_json: result.b64_json,
      mimeType: result.mimeType,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Image generation failed" });
  }
});

export default router;
