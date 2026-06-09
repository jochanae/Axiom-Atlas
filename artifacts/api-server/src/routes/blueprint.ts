import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, sql } from "drizzle-orm";
import { blueprintsTable, db, nexusMessagesTable, projectsTable, sessionsTable } from "@workspace/db";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

type BlueprintContent = {
  title: string;
  idea: string;
  opportunity: string;
  mechanism: string;
  landscape: string;
  risks: string[];
  openQuestions: string[];
  nextSteps: string[];
  visualPrompt: string;
};

function parseProjectId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function serializeBlueprint(row: typeof blueprintsTable.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

function cleanJsonResponse(raw: string): string {
  return raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
}

function parseBlueprintJson(raw: string): BlueprintContent | null {
  try {
    const cleaned = cleanJsonResponse(raw);
    const match = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : cleaned) as Partial<BlueprintContent>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.idea !== "string" ||
      typeof parsed.opportunity !== "string" ||
      typeof parsed.mechanism !== "string" ||
      typeof parsed.landscape !== "string" ||
      !Array.isArray(parsed.risks) ||
      !Array.isArray(parsed.openQuestions) ||
      !Array.isArray(parsed.nextSteps) ||
      typeof parsed.visualPrompt !== "string"
    ) {
      return null;
    }
    return {
      title: parsed.title,
      idea: parsed.idea,
      opportunity: parsed.opportunity,
      mechanism: parsed.mechanism,
      landscape: parsed.landscape,
      risks: parsed.risks.map(String),
      openQuestions: parsed.openQuestions.map(String),
      nextSteps: parsed.nextSteps.map(String),
      visualPrompt: parsed.visualPrompt,
    };
  } catch {
    return null;
  }
}

async function getProject(projectId: number, userId: number) {
  const [project] = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return project ?? null;
}

async function resolveIdeaModeSession(projectId: number, requestedSessionId: number | null) {
  if (requestedSessionId) {
    const [session] = await db
      .select({ id: sessionsTable.id, ideaMode: (sessionsTable as any).ideaMode })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, requestedSessionId), eq(sessionsTable.projectId, projectId)))
      .limit(1);
    return (session as any)?.ideaMode ? session.id : null;
  }

  const [session] = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.projectId, projectId), eq((sessionsTable as any).ideaMode, true)))
    .orderBy(desc(sessionsTable.updatedAt))
    .limit(1);
  return session?.id ?? null;
}

async function loadIdeaConversation(projectId: number, sessionId: number) {
  const rows = await db
    .select({ role: nexusMessagesTable.role, content: nexusMessagesTable.content, createdAt: nexusMessagesTable.createdAt })
    .from(nexusMessagesTable)
    .where(and(
      eq(nexusMessagesTable.projectId, projectId),
      eq(nexusMessagesTable.sessionId, sessionId),
      sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'briefing'`,
      sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'reflection'`,
    ))
    .orderBy(desc(nexusMessagesTable.createdAt))
    .limit(30);

  return rows.reverse();
}

function formatConversation(messages: Array<{ role: string; content: string }>): string {
  return messages
    .map((message) => `${message.role === "user" ? "PERSON" : "ATLAS"}: ${message.content}`)
    .join("\n\n");
}

async function generateConversationSummary(conversation: string, blueprint: BlueprintContent): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 220,
      system: "You are Atlas summarizing an idea exploration session for future context. Be brief, concrete, and neutral.",
      messages: [{
        role: "user",
        content: `Conversation:\n${conversation}\n\nBlueprint title: ${blueprint.title}\nIdea: ${blueprint.idea}\n\nWrite a 2-3 sentence summary of what was explored, what seems promising, and what remains unresolved. Return only the summary.`,
      }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    if (text) return text;
  } catch {
    // Summary is helpful but should not block blueprint creation.
  }
  return `${blueprint.title}: ${blueprint.idea} Open questions: ${blueprint.openQuestions.slice(0, 2).join("; ")}`;
}

router.post("/projects/:id/blueprint", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

    const project = await getProject(projectId, userId);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const requestedSessionId = Number((req.body as { sessionId?: unknown })?.sessionId);
    const sessionId = await resolveIdeaModeSession(projectId, Number.isInteger(requestedSessionId) && requestedSessionId > 0 ? requestedSessionId : null);
    if (!sessionId) {
      res.status(400).json({ error: "No idea mode session found for this project" });
      return;
    }

    const messages = await loadIdeaConversation(projectId, sessionId);
    if (messages.length === 0) {
      res.status(400).json({ error: "No idea mode conversation messages found for this project" });
      return;
    }

    const conversation = formatConversation(messages);
    const blueprintResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: `You are a strategic blueprint generator.
You have been given a conversation where someone explored an idea with an AI thinking partner.
Your job is to extract and structure the key insights from that conversation into a clear,
honest, actionable blueprint document.

Be direct. Be honest about gaps and risks.
Do not inflate the opportunity. Do not deflate the idea. Write like a brilliant advisor who
has read everything and is giving their honest take.`,
      messages: [{
        role: "user",
        content: `Here is the conversation:
${conversation}

Generate a blueprint with exactly these 7 sections.
Return ONLY valid JSON, no markdown, no preamble:

{
"title": "short punchy name for this idea",
"idea": "one clear sentence — what it is",
"opportunity": "who needs this and why now — 2-3 sentences",
"mechanism": "how it would work at a high level — 2-4 sentences",
"landscape": "what already exists, honest — 2-3 sentences",
"risks": ["risk 1", "risk 2", "risk 3"],
"openQuestions": ["question 1", "question 2", "question 3"],
"nextSteps": ["most important action", "second action", "third action"],
"visualPrompt": "a detailed description that could be used to generate an image or sketch of this idea — 2-3 sentences describing what it looks like in the real world"
}`,
      }],
    });

    const raw = blueprintResponse.content[0]?.type === "text" ? blueprintResponse.content[0].text : "";
    const content = parseBlueprintJson(raw);
    if (!content) {
      res.status(500).json({ error: "Failed to parse blueprint JSON", rawResponse: raw });
      return;
    }

    const conversationSummary = await generateConversationSummary(conversation, content);
    const [blueprint] = await db
      .insert(blueprintsTable)
      .values({
        projectId,
        userId,
        sessionId,
        title: content.title,
        content,
        conversationSummary,
      })
      .returning();

    res.status(201).json(serializeBlueprint(blueprint));
  } catch (err) {
    req.log?.error({ err }, "blueprint generation error");
    res.status(500).json({ error: "Failed to generate blueprint" });
  }
});

router.get("/projects/:id/blueprints", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const projectId = parseProjectId(req.params.id);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
  const project = await getProject(projectId, userId);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const blueprints = await db
    .select()
    .from(blueprintsTable)
    .where(and(eq(blueprintsTable.projectId, projectId), eq(blueprintsTable.userId, userId)))
    .orderBy(desc(blueprintsTable.createdAt));

  res.json(blueprints.map(serializeBlueprint));
});

router.get("/projects/:id/blueprints/:blueprintId", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const projectId = parseProjectId(req.params.id);
  const blueprintId = parseProjectId(req.params.blueprintId);
  if (!projectId || !blueprintId) { res.status(400).json({ error: "Invalid id" }); return; }
  const project = await getProject(projectId, userId);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [blueprint] = await db
    .select()
    .from(blueprintsTable)
    .where(and(
      eq(blueprintsTable.id, blueprintId),
      eq(blueprintsTable.projectId, projectId),
      eq(blueprintsTable.userId, userId),
    ))
    .limit(1);

  if (!blueprint) { res.status(404).json({ error: "Blueprint not found" }); return; }
  res.json(serializeBlueprint(blueprint));
});

export default router;
