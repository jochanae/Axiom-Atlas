// Atlas code-generation edge function.
// Takes a prompt + conversation context and generates React component code.
// Saves the result to generated_files and returns it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { composeAtlasPrompt } from "../_shared/atlas-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atlas-user-id, x-atlas-bridge-secret",
};

const CODEGEN_ROLE = `═══════════════════════════════════════════════════════════════
CODE GENERATION — you are now generating deployable React code
═══════════════════════════════════════════════════════════════

You generate self-contained React components using TypeScript + Tailwind CSS v4.

Design system rules:
- Default to a "Luxury Obsidian" aesthetic: dark backgrounds (oklch(0.13 0.01 260)), glassmorphism panels, gold accents (oklch(0.78 0.12 85)).
- Use CSS custom properties for theming when possible.
- All components must be responsive (mobile-first).
- Use modern React patterns: function components, hooks, no class components.

Output format — respond with ONLY a JSON object, no markdown fences, no explanation:
{
  "filename": "ComponentName.tsx",
  "language": "tsx",
  "content": "// The full component code here",
  "description": "One sentence describing what this component does"
}

Rules:
- The component must export a default function.
- Import React if needed, but prefer React 19 patterns (no need to import React for JSX).
- Use Tailwind classes for styling.
- Make it visually polished — this is a builder for premium apps.
- If the user asks for multiple components, generate the primary one and note dependencies.
- Never import from local project files — components must be self-contained.
- Include inline TypeScript types, no separate type files.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    if (!anthropicKey && !lovableKey) {
      throw new Error("No AI API key configured");
    }

    // Auth — PATH 1: Cloud Run bridge
    let userId: string;
    const bridgeUserId = req.headers.get("x-atlas-user-id");
    const bridgeSecret = req.headers.get("x-atlas-bridge-secret");

    if (bridgeUserId && bridgeSecret) {
      const expectedSecret = Deno.env.get("ATLAS_BRIDGE_SECRET");
      if (bridgeSecret !== expectedSecret) {
        throw new Error("Unauthorized — bridge secret mismatch");
      }
      userId = bridgeUserId;
    } else {
      // PATH 2: Legacy Supabase JWT fallback
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) throw new Error("Missing auth");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
        error: authError,
      } = await userClient.auth.getUser();
      if (authError || !user) throw new Error("Unauthorized");
      userId = user.id;
    }

    const { projectId, sessionId, prompt, context } = await req.json();
    if (!projectId || !prompt) throw new Error("Missing projectId or prompt");

    // Build context from compass + recent conversation
    const admin = createClient(supabaseUrl, serviceKey);

    const [compassRes, historyRes] = await Promise.all([
      admin
        .from("project_compass")
        .select("compass_md, aesthetics, audience")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .order("version", { ascending: false })
        .limit(1),
      sessionId
        ? admin
            .from("chat_messages")
            .select("role, content")
            .eq("session_id", sessionId)
            .eq("user_id", userId)
            .order("created_at", { ascending: true })
            .limit(20)
        : Promise.resolve({ data: [] }),
    ]);

    const compass = compassRes.data?.[0];
    const history = (historyRes.data ?? []) as Array<{
      role: string;
      content: string;
    }>;

    let contextBlock = "";
    if (compass) {
      contextBlock += `\n\nPROJECT COMPASS:\n${compass.compass_md || "No compass set."}\nAesthetics: ${compass.aesthetics || "Luxury Obsidian"}\nAudience: ${compass.audience || "Not specified"}`;
    }
    if (context) {
      contextBlock += `\n\nADDITIONAL CONTEXT:\n${context}`;
    }

    const systemPrompt =
      composeAtlasPrompt(CODEGEN_ROLE) + contextBlock;

    const messages = [
      ...history.slice(-10).map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
      {
        role: "user",
        content: `Generate a React component for: ${prompt}`,
      },
    ];

    // Call AI
    let aiResponse: string;

    if (anthropicKey) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Anthropic error ${res.status}: ${errBody}`);
      }
      const result = await res.json();
      aiResponse =
        result.content?.[0]?.text ?? "";
    } else {
      // Lovable AI Gateway
      const res = await fetch(
        "https://ai-gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lovableKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: systemPrompt },
              ...messages,
            ],
            max_tokens: 4096,
          }),
        },
      );
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`AI Gateway error ${res.status}: ${errBody}`);
      }
      const result = await res.json();
      aiResponse =
        result.choices?.[0]?.message?.content ?? "";
    }

    // Parse the JSON response
    let parsed: {
      filename: string;
      language: string;
      content: string;
      description: string;
    };
    try {
      // Strip markdown fences if present
      const cleaned = aiResponse
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If AI didn't return valid JSON, wrap the response as a component
      parsed = {
        filename: "GeneratedComponent.tsx",
        language: "tsx",
        content: aiResponse,
        description: "AI-generated component",
      };
    }

    // Save to generated_files
    const { data: saved, error: saveError } = await admin
      .from("generated_files")
      .insert({
        user_id: userId,
        project_id: projectId,
        session_id: sessionId || null,
        filename: parsed.filename,
        language: parsed.language,
        content: parsed.content,
        status: "draft",
      })
      .select("id, filename, language, content, status, version, created_at")
      .single();

    if (saveError) {
      console.error("Save error:", saveError);
      // Still return the generated code even if save fails
    }

    return new Response(
      JSON.stringify({
        file: saved ?? {
          filename: parsed.filename,
          language: parsed.language,
          content: parsed.content,
          description: parsed.description,
        },
        description: parsed.description,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("atlas-codegen error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
