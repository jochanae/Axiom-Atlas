// Whisper Gate v1 — generates a Project_Compass.md artifact from
// three structured discovery answers.
//
// Constitutional alignment (§V "Four Entry Gates", §VI "Discovery"):
// - Whisper is the conceptual entry gate. It does not write code.
// - Output is a markdown Compass document, stored in project_compass
//   AND echoed into chat_messages so the existing Drawer detects it
//   as a structured doc artifact.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  projectId: string;
  audience: string;
  aesthetics: string;
  seedMaterial: string;
  hasAttachment?: boolean;
  attachmentHint?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const user = userData.user;

    const body = (await req.json()) as Payload;
    if (!body.projectId || !body.audience?.trim() || !body.aesthetics?.trim()) {
      return json({ error: "Missing required fields" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return json({ error: "LOVABLE_API_KEY not configured" }, 500);
    }

    const seedNote = body.hasAttachment
      ? `${body.seedMaterial || "(no description)"}\n\n[User attached source material: ${body.attachmentHint || "ZIP / file (parsing deferred to v2)"}]`
      : body.seedMaterial || "(none provided)";

    const prompt = `You are Atlas, generating a Project_Compass.md document for a new project.

Three discovery answers from the operator:

## Audience
${body.audience}

## Aesthetics
${body.aesthetics}

## Seed material
${seedNote}

Produce a markdown document with EXACTLY these sections, each as an H2 heading:
## North Star
## Audience
## Voice & Aesthetics
## Working Material
## First Three Moves

Rules:
- No code blocks. No tables. Prose and short bullet lists only.
- Be concrete and operator-grade. No generic SaaS filler.
- "First Three Moves" is exactly three numbered actions, each one sentence.
- Total length: 250-450 words.
- Do NOT wrap the output in fences. Output raw markdown only.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You write tight, specific operator documents." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return json({ error: `AI gateway error: ${errText}` }, 502);
    }

    const aiData = await aiRes.json();
    const compassMd: string =
      aiData?.choices?.[0]?.message?.content?.trim() ?? "";

    if (!compassMd) {
      return json({ error: "AI returned empty content" }, 502);
    }

    // Determine next version
    const { data: latest } = await supabase
      .from("project_compass")
      .select("version")
      .eq("project_id", body.projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((latest as { version?: number } | null)?.version ?? 0) + 1;

    const { data: inserted, error: insertError } = await supabase
      .from("project_compass")
      .insert({
        project_id: body.projectId,
        user_id: user.id,
        version: nextVersion,
        audience: body.audience,
        aesthetics: body.aesthetics,
        seed_material: body.seedMaterial || null,
        has_attachment: !!body.hasAttachment,
        attachment_hint: body.attachmentHint || null,
        compass_md: compassMd,
        status: "active",
      })
      .select("*")
      .single();

    if (insertError) {
      return json({ error: insertError.message }, 500);
    }

    return json({ compass: inserted, compass_md: compassMd });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
