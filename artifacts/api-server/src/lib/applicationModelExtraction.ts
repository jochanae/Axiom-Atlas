/**
 * Conversation extraction pass for the Application Model.
 *
 * After each Atlas response, this fires a lightweight Haiku call that reads
 * the current Application Model state and the conversation turn, then returns
 * a partial PATCH diff. The diff is applied asynchronously — it never blocks
 * the chat response.
 *
 * Conservative by design: only extracts what is explicitly mentioned.
 * No inference, no hallucination of structure that wasn't discussed.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db, applicationModelsTable, applicationModelHistoryTable, projectDnaTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logProjectArtifact } from "./artifactLog";
import { logger } from "./logger";
import { syncFlowCanvasFromModel } from "./flowMapSync";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface ApplicationModelPatch {
  identity?: {
    name?: string;
    purpose?: string;
    audience?: string;
    category?: string;
  };
  intent?: {
    summary?: string;
    coreProblems?: string[];
    keyOutcomes?: string[];
    constraints?: string[];
  };
  pages?: Array<{ id: string; name: string; route?: string; description?: string }>;
  components?: Array<{ id: string; name: string; pageId?: string; description?: string }>;
  data?: {
    entities?: Array<{ id: string; name: string; description?: string; fields?: Array<{ name: string; type: string }> }>;
    relationships?: Array<{ id: string; from: string; to: string; type: string; label?: string }>;
  };
  logic?: Array<{ id: string; name: string; type: string; description?: string }>;
  // Project DNA layers
  creativePrinciples?: string[];
  experienceIntent?: {
    emotionalRegister?: string[];
    interactionPosture?: string[];
    visualLanguage?: string[];
    designPrinciples?: string[];
    confidence?: number;
  };
}

const EXTRACTION_PROMPT = `You are extracting structured Application Model data from a conversation turn.

CURRENT APPLICATION MODEL:
{CURRENT_MODEL}

CONVERSATION TURN:
User: {USER_MESSAGE}

Atlas: {ASSISTANT_REPLY}

Extract ONLY what is explicitly mentioned in this conversation turn. Do not infer or hallucinate structure.

Return a JSON object with ONLY the fields that have new or updated information. Omit any field with no new information. Use this structure:

{
  "identity": {
    "name": "project name if mentioned",
    "purpose": "what it does if described",
    "audience": "who it's for if mentioned",
    "category": "app/service/tool/etc if clear"
  },
  "intent": {
    "summary": "one sentence summary of core intent if described",
    "coreProblems": ["problem 1", "problem 2"],
    "keyOutcomes": ["outcome 1"],
    "constraints": ["constraint 1"]
  },
  "pages": [
    { "id": "slug-id", "name": "Page Name", "route": "/route", "description": "what it shows" }
  ],
  "components": [
    { "id": "slug-id", "name": "ComponentName", "description": "what it does" }
  ],
  "data": {
    "entities": [
      { "id": "slug-id", "name": "EntityName", "description": "what it represents", "fields": [{"name": "fieldName", "type": "string"}] }
    ],
    "relationships": [
      { "id": "slug-id", "from": "entity-id", "to": "entity-id", "type": "one-to-many", "label": "has many" }
    ]
  },
  "logic": [
    { "id": "slug-id", "name": "Rule Name", "type": "rule", "description": "what it enforces" }
  ],
  "creativePrinciples": [
    "Short declarative statement about how this product must behave or feel (a principle, not a feature)"
  ],
  "experienceIntent": {
    "emotionalRegister": ["calm", "focused"],
    "interactionPosture": ["quick glances", "low friction"],
    "visualLanguage": ["minimal", "high contrast"],
    "designPrinciples": ["Show don't tell", "Progressive disclosure"],
    "confidence": 70
  }
}

Rules:
- If a field has no new information from this turn, OMIT it entirely (do not return empty arrays or null)
- For arrays (pages, components, entities), only include NEWLY mentioned items, not items already in the model
- For identity and intent text fields, only include if this turn explicitly describes them
- Use kebab-case for id fields
- Keep descriptions short (1 sentence max)
- creativePrinciples: ONLY extract if the conversation explicitly discusses HOW the product should feel or behave as a product philosophy (not a feature list). Each entry is a short statement like "Never interrupt the user's flow" or "Speed is a feature". Do NOT extract if the conversation is purely technical.
- experienceIntent: ONLY extract if the conversation describes emotional, aesthetic, or interaction qualities (e.g. "it should feel calm", "like a tool not an app", "dark and focused"). confidence is 0-100 reflecting how explicitly these were discussed. Overwrite — this is a living brief.
- If nothing new was mentioned, return {}

Respond with ONLY the JSON object, no explanation.`;

async function getCurrentModel(projectId: number): Promise<Record<string, unknown>> {
  const [amRows, dnaRows] = await Promise.all([
    db.select().from(applicationModelsTable).where(eq(applicationModelsTable.projectId, projectId)).limit(1),
    db.select().from(projectDnaTable).where(eq(projectDnaTable.projectId, projectId)).limit(1),
  ]);

  if (amRows.length === 0) return {};

  const row = amRows[0];
  const dna = dnaRows[0];
  return {
    identity: row.identity ?? {},
    intent: row.intent ?? {},
    pages: row.pages ?? [],
    components: row.components ?? [],
    data: row.data ?? { entities: [], relationships: [] },
    logic: row.logic ?? [],
    creativePrinciples: (dna?.creativePrinciples as string[]) ?? [],
    experienceIntent: (dna?.experienceIntent as Record<string, unknown>) ?? {},
  };
}

async function applyModelPatch(projectId: number, patch: ApplicationModelPatch): Promise<void> {
  const current = await db
    .select()
    .from(applicationModelsTable)
    .where(eq(applicationModelsTable.projectId, projectId))
    .limit(1);

  if (current.length === 0) return;

  const row = current[0];
  const newVersion = row.version + 1;
  const historyRows: Array<{
    projectId: number;
    modelVersion: number;
    fieldChanged: string;
    previousValue: unknown;
    newValue: unknown;
    reason: string;
  }> = [];

  const updates: Record<string, unknown> = { version: newVersion };

  // Merge identity
  if (patch.identity && Object.keys(patch.identity).length > 0) {
    const prev = (row.identity as Record<string, unknown>) ?? {};
    const merged = { ...prev, ...Object.fromEntries(Object.entries(patch.identity).filter(([, v]) => v != null && v !== "")) };
    if (JSON.stringify(merged) !== JSON.stringify(prev)) {
      updates.identity = merged;
      historyRows.push({ projectId, modelVersion: newVersion, fieldChanged: "identity", previousValue: prev, newValue: merged, reason: "conversation-extracted" });
    }
  }

  // Merge intent
  if (patch.intent && Object.keys(patch.intent).length > 0) {
    const prev = (row.intent as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...prev };
    if (patch.intent.summary) merged.summary = patch.intent.summary;
    if (patch.intent.coreProblems?.length) {
      const existing = (prev.coreProblems as string[]) ?? [];
      merged.coreProblems = [...new Set([...existing, ...patch.intent.coreProblems])];
    }
    if (patch.intent.keyOutcomes?.length) {
      const existing = (prev.keyOutcomes as string[]) ?? [];
      merged.keyOutcomes = [...new Set([...existing, ...patch.intent.keyOutcomes])];
    }
    if (patch.intent.constraints?.length) {
      const existing = (prev.constraints as string[]) ?? [];
      merged.constraints = [...new Set([...existing, ...patch.intent.constraints])];
    }
    if (JSON.stringify(merged) !== JSON.stringify(prev)) {
      updates.intent = merged;
      historyRows.push({ projectId, modelVersion: newVersion, fieldChanged: "intent", previousValue: prev, newValue: merged, reason: "conversation-extracted" });
    }
  }

  // Merge pages — dedup by id AND name (case-insensitive) to prevent duplicates
  // when Haiku generates a different slug for a page that already exists.
  if (patch.pages?.length) {
    const prev = (row.pages as Array<{ id: string; name: string }>) ?? [];
    const existingIds = new Set(prev.map((p) => p.id));
    const existingNames = new Set(prev.map((p) => p.name.toLowerCase()));
    const newPages = patch.pages.filter(
      (p) => p.id && p.name && !existingIds.has(p.id) && !existingNames.has(p.name.toLowerCase()),
    );
    if (newPages.length > 0) {
      const merged = [...prev, ...newPages];
      updates.pages = merged;
      historyRows.push({ projectId, modelVersion: newVersion, fieldChanged: "pages", previousValue: prev, newValue: merged, reason: "conversation-extracted" });
    }
  }

  // Merge components — dedup by id AND name
  if (patch.components?.length) {
    const prev = (row.components as Array<{ id: string; name: string }>) ?? [];
    const existingIds = new Set(prev.map((c) => c.id));
    const existingNames = new Set(prev.map((c) => c.name.toLowerCase()));
    const newComponents = patch.components.filter(
      (c) => c.id && c.name && !existingIds.has(c.id) && !existingNames.has(c.name.toLowerCase()),
    );
    if (newComponents.length > 0) {
      const merged = [...prev, ...newComponents];
      updates.components = merged;
      historyRows.push({ projectId, modelVersion: newVersion, fieldChanged: "components", previousValue: prev, newValue: merged, reason: "conversation-extracted" });
    }
  }

  // Merge data (entities + relationships) — dedup by id AND name
  if (patch.data) {
    const prevData = (row.data as { entities?: Array<{ id: string; name: string }>; relationships?: Array<{ id: string }> }) ?? {};
    const prevEntities = prevData.entities ?? [];
    const prevRels = prevData.relationships ?? [];
    let changed = false;
    const mergedEntities = [...prevEntities];
    const mergedRels = [...prevRels];

    if (patch.data.entities?.length) {
      const existingIds = new Set(prevEntities.map((e) => e.id));
      const existingNames = new Set(prevEntities.map((e) => e.name.toLowerCase()));
      const newEntities = patch.data.entities.filter(
        (e) => e.id && e.name && !existingIds.has(e.id) && !existingNames.has(e.name.toLowerCase()),
      );
      if (newEntities.length > 0) { mergedEntities.push(...newEntities); changed = true; }
    }
    if (patch.data.relationships?.length) {
      const existingIds = new Set(prevRels.map((r) => r.id));
      const newRels = patch.data.relationships.filter((r) => !existingIds.has(r.id));
      if (newRels.length > 0) { mergedRels.push(...newRels); changed = true; }
    }
    if (changed) {
      const mergedData = { entities: mergedEntities, relationships: mergedRels };
      updates.data = mergedData;
      historyRows.push({ projectId, modelVersion: newVersion, fieldChanged: "data", previousValue: prevData, newValue: mergedData, reason: "conversation-extracted" });
    }
  }

  // Merge logic — dedup by id AND name
  if (patch.logic?.length) {
    const prev = (row.logic as Array<{ id: string; name: string }>) ?? [];
    const existingIds = new Set(prev.map((l) => l.id));
    const existingNames = new Set(prev.map((l) => l.name.toLowerCase()));
    const newLogic = patch.logic.filter(
      (l) => l.id && l.name && !existingIds.has(l.id) && !existingNames.has(l.name.toLowerCase()),
    );
    if (newLogic.length > 0) {
      const merged = [...prev, ...newLogic];
      updates.logic = merged;
      historyRows.push({ projectId, modelVersion: newVersion, fieldChanged: "logic", previousValue: prev, newValue: merged, reason: "conversation-extracted" });
    }
  }

  if (historyRows.length === 0 && !patch.creativePrinciples?.length && !patch.experienceIntent) return; // nothing new

  // Route DNA fields to project_dna table (not application_models); awaited so ordering is deterministic
  await upsertDnaFields(projectId, patch);

  // Stamp lastExtractedAt in buildState (no history record — operational metadata only)
  const prevBuildState = (row.buildState as Record<string, unknown>) ?? {};
  updates.buildState = { ...prevBuildState, lastExtractedAt: new Date().toISOString() };

  await db.update(applicationModelsTable).set(updates as any).where(eq(applicationModelsTable.projectId, projectId));
  if (historyRows.length > 0) {
    await db.insert(applicationModelHistoryTable).values(historyRows);
  }

  // Propagate to Flow Map canvas when pages or data entities changed.
  // Fire-and-forget — safe because extractAndUpdateApplicationModel is already non-blocking.
  if (updates.pages !== undefined || updates.data !== undefined) {
    syncFlowCanvasFromModel(projectId).catch((err) =>
      logger.warn({ err, projectId }, "flow sync after AM extraction failed — non-fatal"),
    );
  }
}

// ── DNA upsert helper ────────────────────────────────────────────────────────
// Writes creativePrinciples and/or experienceIntent to project_dna.
// Uses INSERT...ON CONFLICT DO UPDATE so it's safe to call for new projects.
async function upsertDnaFields(projectId: number, patch: ApplicationModelPatch): Promise<void> {
  const hasPrinciples = (patch.creativePrinciples?.length ?? 0) > 0;
  const hasEI = patch.experienceIntent && Object.keys(patch.experienceIntent).length > 0;
  if (!hasPrinciples && !hasEI) return;

  await db.transaction(async (tx) => {
    // Ensure the row exists before locking — ON CONFLICT DO NOTHING is safe here because the
    // SELECT FOR UPDATE below runs in the same transaction, so we always lock the row we just created.
    await tx.execute(sql`
      INSERT INTO project_dna (project_id) VALUES (${projectId})
      ON CONFLICT (project_id) DO NOTHING
    `);

    // Exclusive row lock eliminates concurrent read-modify-write races.
    const locked = await tx.execute(sql`
      SELECT creative_principles, experience_intent, status
      FROM project_dna WHERE project_id = ${projectId} FOR UPDATE
    `);
    const row = (locked as { rows: Array<Record<string, unknown>> }).rows[0] ?? {};

    const updates: Record<string, unknown> = {};

    if (hasPrinciples && patch.creativePrinciples) {
      const prev = (row.creative_principles as string[]) ?? [];
      const prevNorm = new Set(prev.map((p) => p.trim().toLowerCase()));
      const newPrinciples = patch.creativePrinciples.filter((p) => p && !prevNorm.has(p.trim().toLowerCase()));
      if (newPrinciples.length > 0) {
        updates.creativePrinciples = [...prev, ...newPrinciples];
        const prevStatus = (row.status as Record<string, string>) ?? {};
        if (!prevStatus.creativePrinciples || prevStatus.creativePrinciples === "guessed") {
          updates.status = { ...prevStatus, creativePrinciples: "inferred" };
        }
      }
    }

    if (hasEI && patch.experienceIntent) {
      const prev = (row.experience_intent as Record<string, unknown>) ?? {};
      const merged: Record<string, unknown> = { ...prev };
      const ei = patch.experienceIntent;
      if (ei.emotionalRegister?.length)    merged.emotionalRegister = ei.emotionalRegister;
      if (ei.interactionPosture?.length)   merged.interactionPosture = ei.interactionPosture;
      if (ei.visualLanguage?.length)       merged.visualLanguage = ei.visualLanguage;
      if (ei.designPrinciples?.length)     merged.designPrinciples = ei.designPrinciples;
      if (ei.confidence != null)           merged.confidence = ei.confidence;
      if (JSON.stringify(merged) !== JSON.stringify(prev)) {
        updates.experienceIntent = merged;
        const prevStatus = (updates.status as Record<string, unknown> | undefined)
          ?? (row.status as Record<string, unknown>) ?? {};
        const newStatus: Record<string, unknown> = { ...prevStatus };
        const setIfLower = (key: string) => {
          const cur = newStatus[key] as string | undefined;
          if (!cur || cur === "guessed") newStatus[key] = "inferred";
        };
        if (ei.emotionalRegister?.length)   setIfLower("emotionalRegister");
        if (ei.interactionPosture?.length)  setIfLower("interactionPosture");
        if (ei.visualLanguage?.length)      setIfLower("visualLanguage");
        if (ei.designPrinciples?.length)    setIfLower("designPrinciples");
        updates.status = newStatus;
      }
    }

    if (Object.keys(updates).length === 0) return;

    await tx.update(projectDnaTable)
      .set(updates as any)
      .where(eq(projectDnaTable.projectId, projectId));
  });
}

const VISUAL_MEMORY_PROMPT = `You are analyzing an image attached by a product founder — it may be a sketch, wireframe, mockup, photo, moodboard, or any visual artifact.

Your job is to extract design signals that reveal HOW this product should feel, look, and behave — not WHAT it does.

Return a JSON object with ONLY the fields that are clearly signaled by the image. Omit any field with no clear signal.

{
  "description": "1-2 sentence factual description of what the image shows",
  "creativePrinciples": [
    "A design philosophy or constraint revealed by this image — short declarative statement"
  ],
  "experienceIntent": {
    "emotionalRegister": ["calm", "focused"],
    "interactionPosture": ["quick decisions", "low friction"],
    "visualLanguage": ["minimal", "high contrast", "monochrome"],
    "designPrinciples": ["Content-first", "No decorative chrome"],
    "confidence": 75
  },
  "signals": {
    "emotionalRegister": ["same as experienceIntent.emotionalRegister — for the sketch log"],
    "visualLanguage": ["same as experienceIntent.visualLanguage — for the sketch log"],
    "designPrinciples": ["same as experienceIntent.designPrinciples — for the sketch log"]
  }
}

Rules:
- description: always required — describe the artifact type and key visual choices
- creativePrinciples: only if the layout/style choices reveal a clear product philosophy (e.g. "Density over whitespace", "Single action per screen")
- experienceIntent: only extract sub-fields that the image clearly signals; confidence = how explicitly (0-100)
- signals: mirrors emotionalRegister, visualLanguage, designPrinciples from experienceIntent (for the sketch log record)
- If the image shows no design intent signals (e.g. it's a text screenshot or unrelated photo), return just {"description": "..."}

Respond with ONLY the JSON object, no explanation.`;

export async function extractVisualMemoryFromAttachments({
  projectId,
  attachments,
  userMessage,
}: {
  projectId: number;
  attachments: Array<{ base64: string; mediaType: string; name?: string }>;
  userMessage?: string;
}): Promise<void> {
  if (!projectId || attachments.length === 0) return;

  // Only process image attachments (not PDFs or other binary)
  const imageAttachments = attachments.filter((a) =>
    a.mediaType.startsWith("image/") && a.base64.length > 0,
  );
  if (imageAttachments.length === 0) return;

  for (const attachment of imageAttachments) {
    try {
      const mediaType = attachment.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!validTypes.includes(mediaType)) continue;

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 768,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: attachment.base64 },
              },
              {
                type: "text",
                text: VISUAL_MEMORY_PROMPT + (userMessage ? `\n\nUser's caption: "${userMessage.slice(0, 300)}"` : ""),
              },
            ],
          },
        ],
      });

      const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
      if (!raw) continue;

      const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      let result: {
        description?: string;
        creativePrinciples?: string[];
        experienceIntent?: {
          emotionalRegister?: string[];
          interactionPosture?: string[];
          visualLanguage?: string[];
          designPrinciples?: string[];
          confidence?: number;
        };
        signals?: {
          emotionalRegister?: string[];
          visualLanguage?: string[];
          designPrinciples?: string[];
        };
      };
      try {
        result = JSON.parse(jsonStr);
      } catch {
        logger.warn({ raw, projectId }, "visualMemoryExtraction: JSON parse failed");
        continue;
      }

      if (!result.description) continue;

      // Build the patch for the AM
      const patch: ApplicationModelPatch = {};
      if (result.creativePrinciples?.length) patch.creativePrinciples = result.creativePrinciples;
      if (result.experienceIntent && Object.keys(result.experienceIntent).length > 0) {
        patch.experienceIntent = result.experienceIntent;
      }

      // Append to visualSketches log (no raw pixels — compact summary only)
      const sketchEntry = {
        analyzedAt: new Date().toISOString(),
        description: result.description,
        signals: {
          emotionalRegister: result.signals?.emotionalRegister ?? result.experienceIntent?.emotionalRegister ?? [],
          visualLanguage: result.signals?.visualLanguage ?? result.experienceIntent?.visualLanguage ?? [],
          designPrinciples: result.signals?.designPrinciples ?? result.experienceIntent?.designPrinciples ?? [],
        },
      };

      // Write to AM: merge DNA patch + append sketch entry
      const current = await db
        .select()
        .from(applicationModelsTable)
        .where(eq(applicationModelsTable.projectId, projectId))
        .limit(1);

      if (current.length === 0) continue;
      const row = current[0];

      // Apply DNA signals via existing merge logic
      if (Object.keys(patch).length > 0) {
        await applyModelPatch(projectId, patch);
      }

      // Append sketch entry to project_dna.visual_sketches — atomic transaction prevents lost appends
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO project_dna (project_id) VALUES (${projectId})
          ON CONFLICT (project_id) DO NOTHING
        `);
        const locked = await tx.execute(sql`
          SELECT visual_sketches FROM project_dna WHERE project_id = ${projectId} FOR UPDATE
        `);
        const dnaRow = (locked as { rows: Array<Record<string, unknown>> }).rows[0] ?? {};
        const prevSketches = (dnaRow.visual_sketches as unknown[]) ?? [];
        const newSketches = [...prevSketches, sketchEntry];
        await tx.update(projectDnaTable)
          .set({ visualSketches: newSketches as any })
          .where(eq(projectDnaTable.projectId, projectId));
      });

      logger.info({ projectId, description: result.description.slice(0, 80) }, "visual memory: sketch processed");

      // Log to artifact gallery — fire and forget
      void logProjectArtifact({
        projectId,
        type: "visual_sketch",
        title: attachment.name ? `Sketch: ${attachment.name.slice(0, 60)}` : "Visual Sketch",
        metadata: { analyzedAt: sketchEntry.analyzedAt },
        payload: {
          description: sketchEntry.description,
          signals: sketchEntry.signals,
        },
      });
    } catch (err) {
      logger.warn({ err, projectId }, "visual memory extraction: failed for one attachment — non-fatal");
    }
  }
}

export async function extractAndUpdateApplicationModel({
  projectId,
  userMessage,
  assistantReply,
}: {
  projectId: number;
  userMessage: string;
  assistantReply: string;
}): Promise<void> {
  if (!projectId || !userMessage || !assistantReply) return;
  // Only extract when there's real content — skip greetings, acks, etc.
  if (assistantReply.trim().length < 100) {
    logger.info({ projectId, replyLen: assistantReply.trim().length }, "AM extraction: skipped (reply too short)");
    return;
  }

  try {
    const currentModel = await getCurrentModel(projectId);

    const prompt = EXTRACTION_PROMPT
      .replace("{CURRENT_MODEL}", JSON.stringify(currentModel, null, 2))
      .replace("{USER_MESSAGE}", userMessage.slice(0, 2000))
      .replace("{ASSISTANT_REPLY}", assistantReply.slice(0, 3000));

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    if (!raw || raw === "{}") return;

    // Parse JSON — strip markdown fences if present
    const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    let patch: ApplicationModelPatch;
    try {
      patch = JSON.parse(jsonStr);
    } catch {
      logger.warn({ raw }, "applicationModelExtraction: JSON parse failed");
      return;
    }

    if (Object.keys(patch).length === 0) {
      logger.info({ projectId }, "AM extraction: skipped (empty patch — no new model data detected)");
      return;
    }
    const fields = Object.keys(patch);
    await applyModelPatch(projectId, patch);
    logger.info({ projectId, fields }, "AM extraction: applied");

    // Flow sync fires inside applyModelPatch when pages/data changed.
    // Log which structural fields triggered it for traceability.
    const structuralFields = fields.filter(f => f === "pages" || f === "data");
    if (structuralFields.length > 0) {
      logger.info({ projectId, structuralFields }, "AM extraction: flow sync triggered");
    } else {
      logger.info({ projectId, fields }, "AM extraction: flow sync skipped (no structural changes)");
    }
  } catch (err) {
    logger.warn({ err, projectId }, "AM extraction: failed — non-fatal");
  }
}
