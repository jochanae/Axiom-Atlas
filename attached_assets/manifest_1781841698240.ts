/**
 * POST /api/manifest/decide — Flow 3: The Builder Engine
 *
 * Spec: ATLAS MANIFEST (Flow 3 Specification — The Builder Engine)
 *
 * Sequence:
 *   1. Load project context (name, description, memory, committed decisions)
 *   2. Load recent session messages for conversation context
 *   3. Claude: compute Manifest Score (5 criteria) + First Artifact decision
 *   4. If score < 5 → return missing criteria, do not generate
 *   5. If score ≥ 5 → Claude: generate the First Artifact component
 *   6. Sanitize generated code for browser <script type="text/babel"> execution
 *   7. Return decision + generatedCode + componentName
 */

import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db, projectsTable, entriesTable, chatMessagesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── helpers ──────────────────────────────────────────────────────────────────

function parseMemorySummary(memory: string | null | undefined): string {
  if (!memory) return "";
  try {
    const m = JSON.parse(memory) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof m?.summary === "string") parts.push(m.summary);
    if (m?.identity) parts.push(JSON.stringify(m.identity).slice(0, 400));
    if (m?.tiers && typeof m.tiers === "object") {
      const allTiers = Object.values(m.tiers as Record<string, unknown[]>).flat() as Array<{ content?: string; text?: string }>;
      parts.push(...allTiers.map((t) => t?.content ?? t?.text ?? "").filter(Boolean).slice(0, 8));
    }
    return parts.join("\n").slice(0, 2000);
  } catch {
    return memory.slice(0, 1000);
  }
}

/**
 * Strip anything that crashes a browser <script type="text/babel">:
 * - import / export statements (hooks are pre-destructured by the renderer)
 * - markdown code fences
 */
function sanitizeForBrowser(code: string): string {
  return code
    .replace(/^```[a-z]*\n?/gm, "")
    .replace(/^```$/gm, "")
    .replace(/^import\s+[\s\S]*?(?:from\s+['"][^'"]+['"])?;?\s*$/gm, "")
    .replace(/^export\s+default\s+\w+;?\s*$/gm, "")
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, "")
    .replace(/^export\s+(?=const|function|class)/gm, "")
    .trim();
}

// ── route ─────────────────────────────────────────────────────────────────────

router.post("/manifest/decide", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const { projectId, sessionId } = req.body as { projectId: unknown; sessionId?: unknown };

  const numericProjectId = typeof projectId === "number" ? projectId : parseInt(String(projectId), 10);
  if (!Number.isFinite(numericProjectId)) {
    res.status(400).json({ error: "Missing or invalid projectId" });
    return;
  }

  // ── 1. Load project ──────────────────────────────────────────────────────
  const [project] = await db
    .select({ id: projectsTable.id, name: projectsTable.name, description: projectsTable.description, memory: projectsTable.memory, status: projectsTable.status })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, numericProjectId), eq(projectsTable.userId, userId)));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // ── 2. Load committed decisions ──────────────────────────────────────────
  const committedEntries = await db
    .select({ title: entriesTable.title, summary: entriesTable.summary })
    .from(entriesTable)
    .where(and(eq(entriesTable.projectId, numericProjectId), eq(entriesTable.status, "committed")))
    .limit(20);

  // ── 3. Load recent session messages ─────────────────────────────────────
  let recentMessages: Array<{ role: string; content: string }> = [];
  const numericSessionId = typeof sessionId === "number" ? sessionId : parseInt(String(sessionId ?? ""), 10);
  if (Number.isFinite(numericSessionId)) {
    recentMessages = await db
      .select({ role: chatMessagesTable.role, content: chatMessagesTable.content })
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.sessionId, numericSessionId))
      .orderBy(desc(chatMessagesTable.id))
      .limit(30);
    recentMessages.reverse(); // chronological order
  }

  // ── 4. Build context block ───────────────────────────────────────────────
  const memorySummary = parseMemorySummary(project.memory);
  const decisionLines = committedEntries
    .map((e) => `• ${e.title}${e.summary ? ` — ${e.summary.slice(0, 150)}` : ""}`)
    .join("\n");
  const conversationSnippet = recentMessages
    .slice(-20)
    .map((m) => `${m.role === "assistant" ? "ATLAS" : "USER"}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const contextBlock = [
    `Project: ${project.name}`,
    project.description ? `Description: ${project.description}` : "",
    committedEntries.length > 0 ? `\nCommitted decisions:\n${decisionLines}` : "",
    memorySummary ? `\nProject memory:\n${memorySummary}` : "",
    conversationSnippet ? `\nRecent conversation:\n${conversationSnippet}` : "",
  ].filter(Boolean).join("\n");

  // ── 5. Claude: Manifest Score + First Artifact decision ──────────────────
  const scoreResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1200,
    messages: [
      {
        role: "user",
        content: `You are the Axiom Manifest engine (Flow 3). You score a project's readiness to manifest and decide what the first artifact should be.

${contextBlock}

---

Score this project on exactly these 5 criteria (true = clearly present, false = not established):

1. Promise — Do we know what this does for the user?
2. Primary User — Do we know who uses it first?
3. Input — Do we know what the user gives the system?
4. Output — Do we know what the system returns to the user?
5. Core Moment — Do we know the single moment where the idea becomes real?

If any criterion is false, name what specifically needs to be established before we can proceed.

If all 5 are true, determine:
- First Artifact: the single smallest experience that proves the core moment (one screen, one flow, one interaction — not the whole product)
- Name it concisely and specifically for THIS project
- Describe what it demonstrates in one sentence
- List 3-5 building steps for generating it
- Engine: always "atlas-generated" for a single screen
- Engine reason: one sentence
- Complexity: low / medium / high
- Deployment required: always false

Respond ONLY in this exact format — no other text:

SCORE
promise: true
primaryUser: false
input: true
output: true
coreMoment: false
END_SCORE

MISSING
What needs to be established before manifest can proceed (only if any score is false)
END_MISSING

DECISION
firstArtifactName: <specific name>
firstArtifactDescription: <one sentence>
steps: <step 1> | <step 2> | <step 3>
engineReason: <one sentence>
complexity: medium
END_DECISION`,
      },
    ],
  });

  const scoreRaw = scoreResponse.content[0].type === "text" ? scoreResponse.content[0].text : "";

  // Parse score
  const scoreBlock = scoreRaw.match(/SCORE\n([\s\S]*?)\nEND_SCORE/)?.[1] ?? "";
  const parseBoolean = (key: string) => new RegExp(`^${key}:\\s*true`, "im").test(scoreBlock);
  const scoreBreakdown = {
    promise: parseBoolean("promise"),
    primaryUser: parseBoolean("primaryUser"),
    input: parseBoolean("input"),
    output: parseBoolean("output"),
    coreMoment: parseBoolean("coreMoment"),
  };
  const manifestScore = Object.values(scoreBreakdown).filter(Boolean).length;

  if (manifestScore < 5) {
    const missingBlock = scoreRaw.match(/MISSING\n([\s\S]*?)\nEND_MISSING/)?.[1]?.trim() ?? "";
    const missingCriteria = missingBlock
      ? missingBlock.split("\n").map((l) => l.replace(/^[-•]\s*/, "").trim()).filter(Boolean)
      : Object.entries(scoreBreakdown)
          .filter(([, v]) => !v)
          .map(([k]) => {
            const labels: Record<string, string> = {
              promise: "What does this product do for the user?",
              primaryUser: "Who is the first person to use this?",
              input: "What does the user give the system?",
              output: "What does the system return to the user?",
              coreMoment: "What is the single moment where this idea becomes real?",
            };
            return labels[k] ?? k;
          });

    res.json({ ready: false, missingCriteria });
    return;
  }

  // Parse decision
  const decisionBlock = scoreRaw.match(/DECISION\n([\s\S]*?)\nEND_DECISION/)?.[1] ?? "";
  const parseField = (key: string) => decisionBlock.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";

  const firstArtifactName = parseField("firstArtifactName") || `${project.name} — First Artifact`;
  const firstArtifactDescription = parseField("firstArtifactDescription") || "Core product experience.";
  const stepsRaw = parseField("steps");
  const firstArtifactSteps = stepsRaw ? stepsRaw.split("|").map((s) => s.trim()).filter(Boolean) : ["Analyzing project context", "Generating core experience", "Rendering preview"];
  const engineReason = parseField("engineReason") || "Single screen — atlas-generated is the lightest sufficient engine.";
  const rawComplexity = parseField("complexity");
  const complexity: "low" | "medium" | "high" = rawComplexity === "low" ? "low" : rawComplexity === "high" ? "high" : "medium";

  // ── 6. Claude: Generate the First Artifact component ────────────────────
  const componentResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 5000,
    messages: [
      {
        role: "user",
        content: `You are generating the First Artifact for Axiom's Manifest engine.

Project: ${project.name}
First Artifact: ${firstArtifactName}
What it demonstrates: ${firstArtifactDescription}
Building steps: ${firstArtifactSteps.join(" → ")}

Full project context:
${contextBlock}

---

Generate a single self-contained React component that IS this first artifact — the specific core moment of this product.

EXECUTION ENVIRONMENT — violating these rules produces a blank screen:
• NO import statements. Hooks available: useState, useEffect, useRef, useCallback, useMemo
• NO export statements. Do not write "export default" anywhere.
• NO external libraries. No icons, no chart libs, no UI kits. Pure JSX with inline styles.
• Component MUST start with: const PascalCaseName = () => {

DESIGN STANDARD:
• Dark theme: body bg #0C0A09, surface #161311, card bg #1C1917
• Text: primary #E7E5E4, muted #78716C, gold accent #C9A24C
• Borders: rgba(255,255,255,0.07) default, rgba(201,162,76,0.3) highlighted
• Radius: 10-12px cards, 8px elements
• Typography: system-ui for body, monospace for labels/codes
• Shadows: 0 1px 3px rgba(0,0,0,0.4)
• Make it look production-quality. Not a wireframe. Real content, real data, real interactions.
• Use realistic sample data that fits THIS product's specific domain
• Hover states using useState where they add polish
• The user should look at this and say "yes, that's exactly what I meant"

Respond with the component code ONLY — no explanation, no markers, no fences.
Start directly with: const`,
      },
    ],
  });

  const rawCode = componentResponse.content[0].type === "text" ? componentResponse.content[0].text : "";

  // Extract component name
  const nameMatch = rawCode.match(/^const\s+([A-Z][A-Za-z0-9]+)\s*=/m);
  const componentName = nameMatch?.[1] ?? "ManifestPreview";

  // Sanitize — remove any import/export that would crash browser script execution
  const generatedCode = sanitizeForBrowser(rawCode);

  if (!generatedCode || generatedCode.length < 100) {
    res.status(500).json({ error: "Component generation produced empty output — try again" });
    return;
  }

  // ── 7. Return ────────────────────────────────────────────────────────────
  res.json({
    ready: true,
    decision: {
      firstArtifact: {
        name: firstArtifactName,
        description: firstArtifactDescription,
        steps: firstArtifactSteps,
      },
      activeEngine: "atlas-generated",
      suggestedEngine: "atlas-generated",
      engineReason,
      complexity,
      deploymentRequired: false,
    },
    generatedCode,
    componentName,
  });
});

export default router;
