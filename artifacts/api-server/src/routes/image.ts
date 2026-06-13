import { Router, type IRouter } from "express";
import { GoogleGenAI } from "@google/genai";

const router: IRouter = Router();

router.post("/image/generate", async (req, res): Promise<void> => {
  const { prompt } = req.body as { prompt?: string };
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing prompt" });
    return;
  }

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GOOGLE_GEMINI_API_KEY is not configured on this server" });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-preview-image-generation",
      contents: prompt,
      config: { responseModalities: ["IMAGE", "TEXT"] },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
    const textPart = parts.find((p: any) => p.text);

    if (!imagePart?.inlineData) {
      res.status(500).json({
        error: "No image returned from Gemini",
        text: textPart?.text ?? null,
      });
      return;
    }

    res.json({
      b64_json: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
      text: textPart?.text ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Image generation failed" });
  }
});

export default router;
