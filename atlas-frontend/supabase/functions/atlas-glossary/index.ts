// Glossary-in-Context (§XI Phase 2)
//
// Resolves a parked term into a plain-English explanation card.
// - Cache-first: checks knowledge_entries by slug.
// - On miss: generates with the lowest-trust model that can do the job
//   (Gemini 2.5 Flash Lite per §IX), then upserts via service role.
//
// Returns shape: { entry: KnowledgeEntry, generated: boolean }

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  term: string;
  projectName?: string | null;
  projectContext?: string | null;
};

type Generated = {
  term: string;
  category: string;
  one_liner: string;
  what_it_means: string;
  why_it_comes_up: string;
  reversibility: "reversible" | "partial" | "irreversible";
  reversibility_label: string;
  what_to_do_next: string;
  common_mistake: string;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    // Verify the caller is authenticated (we don't act on their behalf for
    // writes — admin client handles the upsert — but we refuse anonymous calls).
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as Payload;
    const term = (body.term || "").trim();
    if (!term) return json({ error: "Missing term" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const slug = slugify(term);

    // Cache hit by slug
    const { data: existing } = await admin
      .from("knowledge_entries")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (existing) {
      // Bump usage_count (best-effort; don't fail the request)
      await admin
        .from("knowledge_entries")
        .update({ usage_count: ((existing as { usage_count?: number }).usage_count ?? 0) + 1 })
        .eq("slug", slug);
      return json({ entry: existing, generated: false });
    }

    // Cache miss → generate
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const projectLine = body.projectName
      ? `The user is working on a project called "${body.projectName}".`
      : "";
    const contextLine = body.projectContext
      ? `Project context: ${body.projectContext}`
      : "";

    const prompt = `You are Atlas's Mentor Layer. The operator parked this term because they didn't fully understand it: "${term}"

${projectLine} ${contextLine}

Produce a Glossary-in-Context card. Three questions, in this order, in plain English a builder (not an engineer) can use:
1. What does it mean
2. Why does it matter for THIS project (specific, not generic)
3. Is the decision reversible

Respond as STRICT JSON matching this shape (no prose, no fences):
{
  "term": "<canonical term, title-cased>",
  "category": "<one of: Auth, Database, API, Frontend, UX, Process, Architecture, Other>",
  "one_liner": "<single sentence, plain English, what this thing IS>",
  "what_it_means": "<2-3 sentences. The mental model. Concrete.>",
  "why_it_comes_up": "<1-2 sentences. The symptom or moment that makes this matter.>",
  "reversibility": "<reversible | partial | irreversible>",
  "reversibility_label": "<Yes — safely reversible | Partially — data risk | No — hard to undo>",
  "what_to_do_next": "<1-2 sentences. The next concrete move.>",
  "common_mistake": "<1 sentence. The trap a smart operator falls into.>"
}

Rules: No code blocks. No markdown. Builder vocabulary, not engineer vocabulary. Specific over generic. If the term is ambiguous, pick the meaning most relevant to a solo operator building software.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You output strict JSON only. No prose, no fences, no commentary." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return json({ error: `AI gateway error: ${errText}` }, 502);
    }

    const aiData = await aiRes.json();
    const raw: string = aiData?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) return json({ error: "AI returned empty content" }, 502);

    let parsed: Generated;
    try {
      parsed = JSON.parse(raw) as Generated;
    } catch {
      // Strip accidental fences and retry once
      const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
      parsed = JSON.parse(cleaned) as Generated;
    }

    const upsertRow = {
      slug,
      term: parsed.term || term,
      category: parsed.category || "Other",
      one_liner: parsed.one_liner || "",
      what_it_means: parsed.what_it_means || "",
      why_it_comes_up: parsed.why_it_comes_up || "",
      reversibility: parsed.reversibility || "reversible",
      reversibility_label: parsed.reversibility_label || "Yes — safely reversible",
      what_to_do_next: parsed.what_to_do_next || "",
      common_mistake: parsed.common_mistake || "",
      status: "generated",
      usage_count: 1,
    };

    const { data: inserted, error: insertError } = await admin
      .from("knowledge_entries")
      .insert(upsertRow)
      .select("*")
      .single();

    if (insertError) {
      // Race: another caller minted it first → fetch and return
      const { data: raceWinner } = await admin
        .from("knowledge_entries")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (raceWinner) {
        return json({ entry: raceWinner, generated: false });
      }
      return json({ error: insertError.message }, 500);
    }

    return json({ entry: inserted, generated: true });
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
