// health check route
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();

type HealthStatus = "ok" | "degraded" | "down";
type DependencyStatus = "ok" | "missing" | "error";

function envStatus(name: string): "ok" | "missing" {
  return process.env[name]?.trim() ? "ok" : "missing";
}

router.get("/health", async (_req, res): Promise<void> => {
  const errors: string[] = [];
  let database: DependencyStatus = "ok";

  try {
    await db.execute(sql`SELECT 1 FROM users LIMIT 1`);
  } catch (err) {
    database = "error";
    errors.push(err instanceof Error ? err.message : "Database health check failed");
  }

  const checks = {
    server: "ok" as const,
    database,
    anthropic: envStatus("ANTHROPIC_API_KEY"),
    github: envStatus("GITHUB_TOKEN"),
    stripe: envStatus("STRIPE_SECRET_KEY"),
    gemini: envStatus("GOOGLE_GEMINI_API_KEY"),
    openai: envStatus("OPENAI_API_KEY"),
  };

  const status: HealthStatus = checks.database === "error"
    ? "down"
    : Object.values(checks).some((check) => check !== "ok")
      ? "degraded"
      : "ok";

  res.json({
    status,
    timestamp: new Date().toISOString(),
    checks,
    errors,
  });
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health/image-gen-test", async (req, res): Promise<void> => {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { GoogleGenAI } = await import("@google/genai");
  const OpenAI = (await import("openai")).default;

  const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! });
  const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const results: Record<string, unknown> = {
    hasGeminiKey: !!process.env.GOOGLE_GEMINI_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  };

  try {
    const r = await genai.models.generateImages({
      model: "imagen-3.0-generate-004",
      prompt: "A simple red circle on a white background",
      config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio: "1:1" }
    });
    const bytes = r.generatedImages?.[0]?.image?.imageBytes;
    results.imagen3 = bytes ? "SUCCESS" : "NO_BYTES_RETURNED";
  } catch (err: any) {
    results.imagen3 = { error: err?.message, code: err?.code, status: err?.status };
  }

  try {
    const r = await openaiClient.images.generate({
      model: "dall-e-3",
      prompt: "A simple red circle on a white background",
      n: 1,
      size: "1024x1024",
      response_format: "b64_json"
    });
    results.dalle3 = r.data?.[0]?.b64_json ? "SUCCESS" : "NO_IMAGE_RETURNED";
  } catch (err: any) {
    results.dalle3 = { error: err?.message, code: err?.code, status: err?.status };
  }

  res.json(results);
});

export default router;
