import OpenAI from "openai";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export async function embedText(text: string): Promise<number[] | null> {
  const client = getOpenAI();
  if (!client) return null;
  try {
    const input = text.slice(0, 8000).replace(/\n+/g, " ").trim();
    if (!input) return null;
    const resp = await client.embeddings.create({ model: "text-embedding-3-small", input });
    return resp.data[0].embedding;
  } catch {
    return null;
  }
}

export async function upsertEmbedding(params: {
  entityType: "entry" | "session" | "thought";
  entityId: number;
  userId: number;
  projectId: number | null;
  content: string;
}): Promise<void> {
  const embedding = await embedText(params.content);
  if (!embedding) return;
  const vectorStr = `[${embedding.join(",")}]`;
  try {
    await db.execute(sql`
      INSERT INTO embeddings (entity_type, entity_id, user_id, project_id, content, embedding)
      VALUES (
        ${params.entityType},
        ${params.entityId},
        ${params.userId},
        ${params.projectId},
        ${params.content},
        ${vectorStr}::vector
      )
      ON CONFLICT (entity_type, entity_id) DO UPDATE
        SET content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            created_at = NOW()
    `);
  } catch {
    // silent — embeddings are best-effort
  }
}

export interface VectorHit {
  entityType: string;
  entityId: number;
  projectId: number | null;
  content: string;
  score: number;
}

export async function vectorSearch(
  queryText: string,
  options: {
    userId: number;
    projectId?: number | null;
    limit?: number;
    minScore?: number;
  }
): Promise<VectorHit[]> {
  const embedding = await embedText(queryText);
  if (!embedding) return [];
  const vectorStr = `[${embedding.join(",")}]`;
  const limit = options.limit ?? 5;
  const minScore = options.minScore ?? 0.35;
  try {
    const hasProjectFilter = options.projectId != null;
    const rows = await db.execute(
      hasProjectFilter
        ? sql`
            SELECT entity_type, entity_id, project_id, content,
                   1 - (embedding <=> ${vectorStr}::vector) AS score
            FROM embeddings
            WHERE user_id = ${options.userId}
              AND (project_id = ${options.projectId} OR project_id IS NULL)
            ORDER BY embedding <=> ${vectorStr}::vector
            LIMIT ${limit}
          `
        : sql`
            SELECT entity_type, entity_id, project_id, content,
                   1 - (embedding <=> ${vectorStr}::vector) AS score
            FROM embeddings
            WHERE user_id = ${options.userId}
            ORDER BY embedding <=> ${vectorStr}::vector
            LIMIT ${limit}
          `
    );
    return (rows.rows as any[])
      .map((r) => ({
        entityType: r.entity_type as string,
        entityId: Number(r.entity_id),
        projectId: r.project_id != null ? Number(r.project_id) : null,
        content: r.content as string,
        score: Number(r.score),
      }))
      .filter((r) => r.score >= minScore);
  } catch {
    return [];
  }
}

export function buildRagBlock(hits: VectorHit[]): string | null {
  if (!hits.length) return null;
  const lines = hits.map((r) => {
    const label =
      r.entityType === "entry"
        ? "Decision"
        : r.entityType === "session"
        ? "Session"
        : "Note";
    const excerpt = r.content.length > 220 ? r.content.slice(0, 220) + "…" : r.content;
    return `[${label}] ${excerpt}`;
  });
  return lines.join("\n");
}
