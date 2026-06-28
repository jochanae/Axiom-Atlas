import { Router, type IRouter, type Request, type Response } from "express";
import { or, ilike, eq, and, desc, sql } from "drizzle-orm";
import { db, entriesTable, sessionsTable, nexusMessagesTable, thoughtsTable } from "@workspace/db";
import { vectorSearch } from "../lib/embeddings";

const router: IRouter = Router();

// GET /api/search?q=<text>&projectId=<n>
// Blends ILIKE (keyword) results with vector (semantic) results.
// Vector search is best-effort — falls back to ILIKE-only when embeddings are unavailable.
router.get("/search", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const q = (req.query.q as string | undefined)?.trim() ?? "";
  const projectId = req.query.projectId ? Number(req.query.projectId) : null;

  if (!q || q.length < 2) { res.json([]); return; }

  const pattern = `%${q}%`;
  const LIMIT = 8;

  type ResultRow = {
    source: "entry" | "session" | "nexus" | "thought";
    id: number;
    title: string;
    snippet: string;
    projectId: number | null;
    sessionId: number | null;
    createdAt: string;
    score?: number;
  };

  const [ilikeResults, vectorHits] = await Promise.all([
    // ── ILIKE keyword search ──────────────────────────────────────────────────
    Promise.all([
      projectId
        ? db
            .select({
              id: entriesTable.id,
              title: entriesTable.title,
              snippet: sql<string>`coalesce(${entriesTable.summary}, '')`.as("snippet"),
              projectId: entriesTable.projectId,
              sessionId: entriesTable.sessionId,
              createdAt: entriesTable.createdAt,
            })
            .from(entriesTable)
            .where(
              and(
                eq(entriesTable.projectId, projectId),
                or(
                  ilike(entriesTable.title, pattern),
                  ilike(sql`coalesce(${entriesTable.summary}, '')`, pattern),
                  ilike(sql`coalesce(${entriesTable.details}, '')`, pattern),
                )
              )
            )
            .orderBy(desc(entriesTable.createdAt))
            .limit(LIMIT)
        : Promise.resolve([]),

      projectId
        ? db
            .select({
              id: sessionsTable.id,
              title: sessionsTable.title,
              snippet: sql<string>`coalesce(${sessionsTable.buildIntent}, ${sessionsTable.title}, '')`.as("snippet"),
              projectId: sessionsTable.projectId,
              sessionId: sql<null>`null`.as("sessionId"),
              createdAt: sessionsTable.createdAt,
            })
            .from(sessionsTable)
            .where(
              and(
                eq(sessionsTable.projectId, projectId),
                or(
                  ilike(sessionsTable.title, pattern),
                  ilike(sql`coalesce(${sessionsTable.buildIntent}, '')`, pattern),
                )
              )
            )
            .orderBy(desc(sessionsTable.createdAt))
            .limit(LIMIT)
        : Promise.resolve([]),

      projectId
        ? db
            .select({
              id: nexusMessagesTable.id,
              title: sql<string>`substr(${nexusMessagesTable.content}, 1, 80)`.as("title"),
              snippet: sql<string>`substr(${nexusMessagesTable.content}, 1, 180)`.as("snippet"),
              projectId: nexusMessagesTable.projectId,
              sessionId: nexusMessagesTable.sessionId,
              createdAt: nexusMessagesTable.createdAt,
            })
            .from(nexusMessagesTable)
            .where(
              and(
                eq(nexusMessagesTable.projectId, projectId),
                eq(nexusMessagesTable.role, "user"),
                ilike(nexusMessagesTable.content, pattern)
              )
            )
            .orderBy(desc(nexusMessagesTable.createdAt))
            .limit(LIMIT)
        : Promise.resolve([]),

      db
        .select({
          id: thoughtsTable.id,
          title: sql<string>`substr(${thoughtsTable.content}, 1, 80)`.as("title"),
          snippet: sql<string>`substr(${thoughtsTable.content}, 1, 180)`.as("snippet"),
          projectId: sql<null>`null`.as("projectId"),
          sessionId: sql<null>`null`.as("sessionId"),
          createdAt: thoughtsTable.createdAt,
        })
        .from(thoughtsTable)
        .where(
          and(
            eq(thoughtsTable.userId, userId),
            ilike(thoughtsTable.content, pattern)
          )
        )
        .orderBy(desc(thoughtsTable.createdAt))
        .limit(LIMIT),
    ]),

    // ── Vector semantic search ────────────────────────────────────────────────
    vectorSearch(q, { userId, projectId, limit: 10, minScore: 0.38 }).catch(() => []),
  ]);

  const [entries, sessions, nexus, thoughts] = ilikeResults;

  // Build a merged, deduplicated result set
  const seen = new Set<string>();
  const results: ResultRow[] = [];

  const addResult = (row: ResultRow) => {
    const key = `${row.source}:${row.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(row);
  };

  // Add ILIKE results first (always present)
  for (const r of entries)  addResult({ source: "entry",   ...r, createdAt: r.createdAt.toISOString() });
  for (const r of sessions) addResult({ source: "session", ...r, createdAt: r.createdAt.toISOString() });
  for (const r of nexus)    addResult({ source: "nexus",   ...r, createdAt: r.createdAt.toISOString() });
  for (const r of thoughts) addResult({ source: "thought", ...r, createdAt: r.createdAt.toISOString() });

  // Merge semantic results — they surface items ILIKE wouldn't find
  for (const hit of vectorHits) {
    const src =
      hit.entityType === "entry" ? "entry" :
      hit.entityType === "session" ? "session" :
      hit.entityType === "thought" ? "thought" : null;
    if (!src) continue;

    const key = `${src}:${hit.entityId}`;
    if (seen.has(key)) continue; // already in results from ILIKE
    seen.add(key);

    // Truncate content for snippet
    const snippet = hit.content.length > 180 ? hit.content.slice(0, 180) + "…" : hit.content;
    const title   = hit.content.length > 80  ? hit.content.slice(0, 80)  + "…" : hit.content;

    results.push({
      source: src as ResultRow["source"],
      id: hit.entityId,
      title,
      snippet,
      projectId: hit.projectId,
      sessionId: null,
      createdAt: new Date().toISOString(), // no createdAt from vector hit; sort neutral
      score: hit.score,
    });
  }

  // Sort: semantic hits (score present) first by score desc, then by recency
  results.sort((a, b) => {
    if (a.score != null && b.score != null) return b.score - a.score;
    if (a.score != null) return -1;
    if (b.score != null) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  res.json(results);
});

export default router;
