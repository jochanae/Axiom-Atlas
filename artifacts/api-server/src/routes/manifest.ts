import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import {
  db,
  projectsTable,
  projectFlowCanvasTable,
  sessionsTable,
  chatMessagesTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Memory helpers (v2 format — mirrors nexus.ts) ──────────────────────────

interface MemoryEntry {
  tier: 1 | 2 | 3 | 4 | 5;
  text: string;
  createdAt: string;
}

interface MemoryStore {
  v: 2;
  entries: MemoryEntry[];
}

function parseMemoryStore(raw: string | null): MemoryStore {
  if (!raw) return { v: 2, entries: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2 && Array.isArray(parsed.entries)) return parsed as MemoryStore;
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const migrated: MemoryEntry[] = lines.map((line) => ({
      tier: 3 as const,
      text: line.replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, ""),
      createdAt: new Date().toISOString(),
    }));
    return { v: 2, entries: migrated };
  } catch {
    return { v: 2, entries: [] };
  }
}

function renderMemoryContext(store: MemoryStore): string {
  const TIER_LABELS: Record<number, string> = {
    1: "Decisions & Constraints",
    2: "Identity",
    3: "Context",
  };
  const relevant = store.entries.filter((e) => e.tier <= 3);
  if (relevant.length === 0) return "(no project memory)";

  const sections: Record<number, string[]> = { 1: [], 2: [], 3: [] };
  for (const e of relevant) {
    if (sections[e.tier]) sections[e.tier].push(`• ${e.text}`);
  }

  const lines: string[] = [];
  for (const tier of [1, 2, 3] as const) {
    if (sections[tier].length > 0) {
      lines.push(`[${TIER_LABELS[tier]}]`);
      lines.push(...sections[tier]);
    }
  }
  return lines.join("\n");
}

// ── Types ──────────────────────────────────────────────────────────────────

type Engine = "atlas-generated" | "sandbox" | "stackblitz" | "local-dev" | "live-url";

interface ScoreBreakdown {
  promise: boolean;
  primaryUser: boolean;
  input: boolean;
  output: boolean;
  coreMoment: boolean;
}

interface FirstArtifact {
  name: string;
  description: string;
  steps: string[];
}

interface RawScoreData extends ScoreBreakdown {
  missingCriteria: string[];
  firstArtifact: FirstArtifact | null;
  suggestedEngine: Engine;
  engineReason: string;
  complexity: "low" | "medium" | "high";
}

// ── Prompts ────────────────────────────────────────────────────────────────

const SCORING_SYSTEM = `You are the Axiom Manifest Engine. You evaluate whether a project is ready to manifest and, if so, decide what to build first.

Score five criteria (each true/false):
- promise: Do we know what this does for the user?
- primaryUser: Do we know who uses it first?
- input: Do we know what the user gives the system?
- output: Do we know what the system returns to the user?
- coreMoment: Do we know the single moment where the idea becomes real?

If score = 5 (all criteria true), determine:
- The FIRST ARTIFACT — the single smallest experience that proves the core moment. Not the whole app. One screen, one flow, or one interaction. Always specific, never generic ("the upload experience" not "the app").
- The ENGINE that can render it, from this ladder (lightest first):
  - "atlas-generated" — single screen, single workflow, UI proof, no shared state, no external deps
  - "sandbox" — self-contained component with internal logic
  - "stackblitz" — multiple connected screens, shared state required
  - "local-dev" — real engineering, APIs, file system, auth
  - "live-url" — explicit deploy request only

Engineering unknowns (database choices, hosting, auth, APIs) are explicitly ignored at manifest time.

Respond with ONLY valid JSON. No markdown, no explanation outside the JSON:
{
  "promise": boolean,
  "primaryUser": boolean,
  "input": boolean,
  "output": boolean,
  "coreMoment": boolean,
  "missingCriteria": string[],
  "firstArtifact": {
    "name": string,
    "description": string,
    "steps": string[]
  } | null,
  "suggestedEngine": "atlas-generated" | "sandbox" | "stackblitz" | "local-dev" | "live-url",
  "engineReason": string,
  "complexity": "low" | "medium" | "high"
}

Set firstArtifact to null if score < 5. missingCriteria lists the names of false criteria.`;

const ATLAS_GENERATED_SYSTEM = `You are a React component generator for the Atlas preview engine.

Generate a single self-contained React component for the described experience.

Rules:
- One component. No import statements — React, useState, useEffect, useRef, useCallback, useMemo are available as globals.
- Inline styles only. No CSS classes, no Tailwind, no external stylesheets.
- Color palette: background #0C0A09, surface #1C1917, border #292524, text #E7E5E4, muted #A8A29E, gold accent #C9A24C.
- Mobile-first. Max-width 390px, centered in viewport via margin auto.
- Realistic placeholder content — names, amounts, labels that fit the product. Never "Lorem ipsum".
- No console.log. No fetch() calls. No external dependencies.
- Component must be a named function declaration: function ComponentName() { ... }
- Render the full experience implied by the steps, not just a single button.

Response format (no markdown, no explanation):
COMPONENT_NAME: <PascalCase>
---
<complete component code>`;

// ── Route ──────────────────────────────────────────────────────────────────

router.post("/manifest/decide", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  console.log("[manifest/decide]", { userId, userIdType: typeof userId, projectId: req.body?.projectId, projectIdType: typeof req.body?.projectId });
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const projectId = typeof req.body?.projectId === "string"
    ? parseInt(req.body.projectId, 10)
    : req.body?.projectId as number | undefined;

  if (!projectId || !Number.isFinite(projectId)) {
    res.status(400).json({ error: "invalid_project_id", detail: `projectId must be a number, got ${typeof req.body?.projectId}: ${req.body?.projectId}` });
    return;
  }

  const sessionId = typeof req.body?.sessionId === "string"
    ? parseInt(req.body.sessionId, 10)
    : req.body?.sessionId as number | undefined;

  try {
    // 1. Load project — ownership check included
    const [project] = await db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        description: projectsTable.description,
        memory: projectsTable.memory,
      })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // 2. Load flow canvas nodes (optional — may not exist yet)
    const [canvas] = await db
      .select({ nodes: projectFlowCanvasTable.nodes })
      .from(projectFlowCanvasTable)
      .where(eq(projectFlowCanvasTable.projectId, projectId))
      .limit(1);

    // 3. Load recent messages — use provided sessionId or fall back to most recent session
    let recentMessages: Array<{ role: string; content: string }> = [];

    const targetSessionId: number | undefined = sessionId ?? await (async () => {
      const [latest] = await db
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(eq(sessionsTable.projectId, projectId))
        .orderBy(desc(sessionsTable.updatedAt))
        .limit(1);
      return latest?.id;
    })();

    if (targetSessionId) {
      const msgs = await db
        .select({ role: chatMessagesTable.role, content: chatMessagesTable.content })
        .from(chatMessagesTable)
        .where(eq(chatMessagesTable.sessionId, targetSessionId))
        .orderBy(desc(chatMessagesTable.createdAt))
        .limit(16);
      recentMessages = msgs.reverse();
    }

    // 4. Build context strings
    const memoryStore = parseMemoryStore(project.memory as string | null);
    const memoryContext = renderMemoryContext(memoryStore);

    const rawNodes = canvas?.nodes;
    const nodeList = Array.isArray(rawNodes) && rawNodes.length > 0
      ? (rawNodes as any[]).map((n: any) => `[${n.type ?? "node"}] ${n.data?.label ?? n.id}`).join("\n")
      : "(no flow nodes)";

    const conversationSnippet = recentMessages.length > 0
      ? recentMessages
          .map((m) => `${m.role === "assistant" ? "Atlas" : "User"}: ${m.content.slice(0, 500)}`)
          .join("\n\n")
      : "(no conversation yet)";

    // 5. Claude call #1 — Manifest Score + First Artifact Decision
    const scoringPrompt = `PROJECT: ${project.name}
${project.description ? `DESCRIPTION: ${project.description}` : ""}

PROJECT MEMORY:
${memoryContext}

FLOW NODES:
${nodeList}

RECENT CONVERSATION:
${conversationSnippet}`;

    const scoringResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SCORING_SYSTEM,
      messages: [{ role: "user", content: scoringPrompt }],
    });

    const rawScoring = scoringResponse.content[0]?.type === "text"
      ? scoringResponse.content[0].text
      : "{}";

    let scoreData: RawScoreData;
    try {
      const cleaned = rawScoring.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      scoreData = JSON.parse(cleaned) as RawScoreData;
    } catch (parseErr) {
      logger.error({ parseErr, rawScoring }, "manifest/decide: failed to parse scoring response");
      res.status(500).json({ error: "Failed to parse manifest score" });
      return;
    }

    const manifestScore = [
      scoreData.promise,
      scoreData.primaryUser,
      scoreData.input,
      scoreData.output,
      scoreData.coreMoment,
    ].filter(Boolean).length;

    const breakdown: ScoreBreakdown = {
      promise: scoreData.promise,
      primaryUser: scoreData.primaryUser,
      input: scoreData.input,
      output: scoreData.output,
      coreMoment: scoreData.coreMoment,
    };

    // 6. Not ready — return missing criteria so workspace can redirect the conversation
    if (manifestScore < 5) {
      res.json({
        ready: false,
        manifestScore,
        scoreBreakdown: breakdown,
        missingCriteria: scoreData.missingCriteria ?? [],
      });
      return;
    }

    // 7. Ready — V1 always runs Atlas Generated
    // suggestedEngine is preserved so the frontend can display it and escalation paths
    // can be wired in future iterations without changing the response shape.
    const firstArtifact = scoreData.firstArtifact!;
    const activeEngine: Engine = "atlas-generated";

    // 8. Claude call #2 — generate the React component for the first artifact
    const codegenPrompt = `Project: ${project.name}
First artifact: ${firstArtifact.name}
Description: ${firstArtifact.description}
Experience steps:
${firstArtifact.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Project memory:
${memoryContext}

Generate the React component.`;

    const codegenResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: ATLAS_GENERATED_SYSTEM,
      messages: [{ role: "user", content: codegenPrompt }],
    });

    const rawCode = codegenResponse.content[0]?.type === "text"
      ? codegenResponse.content[0].text
      : "";

    const nameMatch = rawCode.match(/^COMPONENT_NAME:\s*(.+)$/m);
    const separatorIndex = rawCode.indexOf("\n---\n");
    const componentName = nameMatch?.[1]?.trim() ?? "ManifestPreview";
    const generatedCode = separatorIndex >= 0
      ? rawCode.slice(separatorIndex + 5).trim()
      : rawCode.trim();

    res.json({
      ready: true,
      manifestScore,
      scoreBreakdown: breakdown,
      decision: {
        firstArtifact,
        activeEngine,
        suggestedEngine: scoreData.suggestedEngine,
        engineReason: scoreData.engineReason,
        complexity: scoreData.complexity,
        deploymentRequired: false,
      },
      generatedCode,
      componentName,
    });

  } catch (err: any) {
    logger.error({ err }, "manifest/decide error");
    res.status(500).json({ error: err?.message ?? "Manifest decision failed" });
  }
});

export default router;
