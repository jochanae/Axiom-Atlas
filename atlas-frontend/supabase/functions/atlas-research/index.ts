// Atlas Sovereign Research — AI-powered web research filtered through
// the project's DNA (compass, ledger, tech stack).
//
// Takes a query + projectId, loads project context, enriches the prompt,
// and returns research results that are relevant to the specific project.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { composeAtlasPrompt } from "../_shared/atlas-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RESEARCH_ROLE = `You are Atlas performing Sovereign Web Research.

Your job is to answer a research query with deep, actionable knowledge filtered through the user's specific project context.

You have access to:
- The project's Compass (audience, aesthetics, north star)
- Recent Ledger decisions (architectural commitments already made)
- The project's tech stack context

Rules:
1. Every answer must be specific to the project's stack and constraints. Generic advice is useless.
2. If a Ledger decision conflicts with a common recommendation, flag it — don't silently override.
3. Cite reasoning. When you recommend something, say WHY it fits this project specifically.
4. Prioritize: Lovable/TanStack Start ecosystem → Supabase ecosystem → general web.
5. If the query is about a technology the project doesn't use, say so and suggest the equivalent in the project's stack.
6. Output format: prose with clear sections. Use ## headings for distinct topics. Keep it under 800 words unless the query demands depth.
7. End with a "Next Move" — one concrete action the user can take right now.`;

type Payload = {
  projectId: string;
  query: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    const body = (await req.json()) as Payload;
    if (!body.projectId || !body.query?.trim()) {
      return json({ error: "Missing projectId or query" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    // ── Gather project context ──
    const [compassRes, ledgerRes, projectRes] = await Promise.all([
      supabase
        .from("project_compass")
        .select("compass_md")
        .eq("project_id", body.projectId)
        .eq("user_id", user.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("entries")
        .select("title, summary, severity, verb, mode")
        .eq("project_id", body.projectId)
        .eq("user_id", user.id)
        .eq("status", "committed")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("projects")
        .select("name")
        .eq("id", body.projectId)
        .single(),
    ]);

    const compassMd = (compassRes.data as { compass_md?: string } | null)?.compass_md ?? null;
    const ledgerEntries = (ledgerRes.data ?? []) as Array<{
      title: string;
      summary: string | null;
      severity: string;
      verb: string | null;
      mode: string | null;
    }>;
    const projectName = (projectRes.data as { name?: string } | null)?.name ?? "Unknown";

    // ── Build context block ──
    const contextParts: string[] = [
      `## Project: ${projectName}`,
      `## Tech Stack\nTanStack Start v1 (React 19, SSR), Supabase (auth, DB, edge functions, storage), Tailwind CSS v4, Cloudflare Workers edge deployment.`,
    ];

    if (compassMd) {
      contextParts.push(`## Project Compass\n${compassMd}`);
    }

    if (ledgerEntries.length > 0) {
      const ledgerBlock = ledgerEntries
        .map((e) => `- [${e.severity}${e.verb ? `/${e.verb}` : ""}${e.mode ? ` · ${e.mode}` : ""}] ${e.title}${e.summary ? `: ${e.summary}` : ""}`)
        .join("\n");
      contextParts.push(`## Recent Ledger Decisions\n${ledgerBlock}`);
    }

    const projectContext = contextParts.join("\n\n");

    // ── Call AI ──
    const systemPrompt = composeAtlasPrompt(RESEARCH_ROLE);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `${projectContext}\n\n---\n\n## Research Query\n${body.query}`,
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return json({ error: `AI gateway error: ${errText}` }, 502);
    }

    const aiData = await aiRes.json();
    const content: string = aiData?.choices?.[0]?.message?.content?.trim() ?? "";

    if (!content) return json({ error: "AI returned empty content" }, 502);

    return json({
      research: content,
      context: {
        project: projectName,
        compassLoaded: !!compassMd,
        ledgerEntriesUsed: ledgerEntries.length,
      },
    });
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
