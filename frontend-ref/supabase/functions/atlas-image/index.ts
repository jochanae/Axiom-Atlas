// Atlas image generation — routes through Lovable AI Gateway.
// Replaces the broken Cloud Run /api/image/generate endpoint.

function buildStyledPrompt(prompt: string, style?: string) {
  const subject = prompt.trim();
  switch (style) {
    case "blueprint":
      return [
        "Create a refined industrial-design concept board.",
        "Show the idea through visuals, form language, materials, linework, orthographic views, exploded details, and composition.",
        "Do not place readable text, labels, paragraphs, UI copy, letters, foreign characters, or gibberish anywhere in the image.",
        "Use only diagram lines, arrows, measurement marks, icons, and abstract annotation shapes where needed.",
        "Subject:",
        subject,
      ].join("\n\n");
    case "moodboard":
      return [
        "Create an editorial mood board collage with cohesive materials, palette, lighting, and atmosphere.",
        "No readable words, no captions, no magazine text, no foreign characters, no gibberish typography.",
        "Subject:",
        subject,
      ].join("\n\n");
    case "wireframe":
      return [
        "Create a clean grayscale wireframe concept with blocks, spacing, interface structure, and layout logic.",
        "Minimize text drastically; prefer empty lines, bars, and shapes over readable copy.",
        "No gibberish text.",
        "Subject:",
        subject,
      ].join("\n\n");
    case "photoreal":
      return [
        "Create a photoreal product reveal with premium materials, believable scale, lighting, and finish.",
        "No overlaid text, no captions, no letters, no gibberish.",
        "Subject:",
        subject,
      ].join("\n\n");
    case "concept":
    case "default":
    default:
      return [
        "Create a strong concept sketch or product visualization focused on form, mood, and composition.",
        "Avoid readable text, labels, captions, foreign characters, and gibberish in the image.",
        "Subject:",
        subject,
      ].join("\n\n");
  }
}
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, style } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const styledPrompt = buildStyledPrompt(prompt, typeof style === "string" ? style : undefined);

    const r = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: {
        "Lovable-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-image-2",
        prompt: styledPrompt,
        size: "1024x1024",
        quality: "low",
        n: 1,
        stream: false,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("[atlas-image] gateway error", r.status, text);
      return new Response(JSON.stringify({ error: `Gateway ${r.status}: ${text}` }), {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await r.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      return new Response(JSON.stringify({ error: "no image in response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ b64_json: b64, mimeType: "image/png" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[atlas-image] error", err);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
