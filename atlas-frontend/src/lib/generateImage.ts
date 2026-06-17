import type { SketchStylePreset } from "@/lib/sketchStylePresets";

/**
 * generateImage — calls the Lovable Cloud edge function `atlas-image`,
 * which routes through the AI Gateway. Bypasses the broken Cloud Run
 * /api/image/generate endpoint.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export type ImageGenerationStyle = SketchStylePreset | "default";

export interface GeneratedImage {
  b64_json: string;
  mimeType: string;
  dataUrl: string;
}

export async function generateImage(
  prompt: string,
  options?: { style?: ImageGenerationStyle }
): Promise<GeneratedImage> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/atlas-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
    body: JSON.stringify({ prompt, style: options?.style ?? "default" }),
  });
  const data = await res.json().catch(() => null) as { b64_json?: string; mimeType?: string; error?: string } | null;
  if (!res.ok || !data?.b64_json) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  const mimeType = data.mimeType ?? "image/png";
  return {
    b64_json: data.b64_json,
    mimeType,
    dataUrl: `data:${mimeType};base64,${data.b64_json}`,
  };
}
