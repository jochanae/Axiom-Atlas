import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  entriesTable,
  projectsTable,
  readinessSnapshotsTable,
  sessionsTable,
} from "@workspace/db";
import { serverTokenAuth } from "../middleware/serverToken";

// SETUP: Add RAILWAY_API_TOKEN to Railway environment variables.
// Use a long random string (32+ chars). Add the same value as
// RAILWAY_API_TOKEN in the Lovable/Vercel environment variables
// so the frontend proxy can include it in x-railway-token headers.

const router: IRouter = Router();

router.use(serverTokenAuth);

function parseUserIdHeader(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const userId = Number(raw);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function requireUserId(req: Request): number | null {
  return parseUserIdHeader(req.headers["x-user-id"]);
}

function serializeProject(p: typeof projectsTable.$inferSelect) {
  const { githubToken, ...rest } = p;
  return {
    ...rest,
    hasGithubToken: !!githubToken,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function buildWeekGrid(rows: any[]): { day: string; sessions: number }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
    const dayStr = d.toISOString().slice(0, 10);
    const found = rows.find((r) => {
      const rStr =
        r.day instanceof Date
          ? r.day.toISOString().slice(0, 10)
          : String(r.day ?? "").slice(0, 10);
      return rStr === dayStr;
    });
    return {
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      sessions: Number(found?.sessions ?? 0),
    };
  });
}

router.get("/health", (_req, res): void => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

router.get("/stats/dashboard", async (req, res): Promise<void> => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(400).json({ error: "Missing or invalid x-user-id header" });
    return;
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const userProjects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId));

  const projectIds = userProjects.map((p) => p.id);

  if (projectIds.length === 0) {
    res.json({
      sessionsThisWeek: 0,
      totalDecisions: 0,
      parkedDecisions: 0,
      violations: 0,
      activeProjects: 0,
      dailySessions: buildWeekGrid([]),
      recentSessions: [],
      projectHealth: [],
    });
    return;
  }

  const [
    sessionsThisWeekResult,
    committedResult,
    parkedResult,
    violationsResult,
    activeResult,
    recentResult,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessionsTable)
      .where(
        and(
          inArray(sessionsTable.projectId, projectIds),
          gte(sessionsTable.createdAt, sevenDaysAgo),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(entriesTable)
      .where(
        and(
          inArray(entriesTable.projectId, projectIds),
          eq(entriesTable.status, "committed"),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(entriesTable)
      .where(
        and(
          inArray(entriesTable.projectId, projectIds),
          eq(entriesTable.status, "parked"),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(entriesTable)
      .where(
        and(
          inArray(entriesTable.projectId, projectIds),
          eq(entriesTable.isViolation, true),
        ),
      ),
    db
      .selectDistinct({ projectId: sessionsTable.projectId })
      .from(sessionsTable)
      .where(
        and(
          inArray(sessionsTable.projectId, projectIds),
          gte(sessionsTable.createdAt, sevenDaysAgo),
        ),
      ),
    db
      .select({
        id: sessionsTable.id,
        title: sessionsTable.title,
        createdAt: sessionsTable.createdAt,
        mode: sessionsTable.mode,
        projectId: projectsTable.id,
        projectName: projectsTable.name,
      })
      .from(sessionsTable)
      .innerJoin(projectsTable, eq(sessionsTable.projectId, projectsTable.id))
      .where(inArray(sessionsTable.projectId, projectIds))
      .orderBy(desc(sessionsTable.createdAt))
      .limit(6),
  ]);

  const pgArr = `{${projectIds.join(",")}}`;

  const [dailyRaw, healthRaw] = await Promise.all([
    db.execute(sql`
      SELECT
        date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
        count(*)::int AS sessions
      FROM sessions
      WHERE project_id = ANY(${pgArr}::int[])
        AND created_at >= ${sevenDaysAgo}
      GROUP BY 1
      ORDER BY 1
    `),
    db.execute(sql`
      SELECT
        p.id,
        p.name,
        p.description,
        count(e.id) FILTER (WHERE e.status = 'committed')::int AS committed,
        count(e.id) FILTER (WHERE e.status = 'parked')::int    AS parked,
        count(e.id) FILTER (WHERE e.is_violation = true)::int  AS violations,
        count(e.id)::int                                       AS total_entries,
        max(s.created_at)                                      AS last_session
      FROM projects p
      LEFT JOIN entries  e ON e.project_id = p.id
      LEFT JOIN sessions s ON s.project_id = p.id
      WHERE p.user_id = ${userId}
      GROUP BY p.id, p.name, p.description
      ORDER BY last_session DESC NULLS LAST
    `),
  ]);

  res.json({
    sessionsThisWeek: sessionsThisWeekResult[0]?.count ?? 0,
    totalDecisions: committedResult[0]?.count ?? 0,
    parkedDecisions: parkedResult[0]?.count ?? 0,
    violations: violationsResult[0]?.count ?? 0,
    activeProjects: activeResult.length,
    dailySessions: buildWeekGrid(dailyRaw.rows as any[]),
    recentSessions: recentResult.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
    projectHealth: (healthRaw.rows as any[]).map((r) => {
      const total = Number(r.total_entries ?? 0);
      const viol = Number(r.violations ?? 0);
      return {
        id: Number(r.id),
        name: String(r.name),
        description: r.description ? String(r.description) : null,
        committed: Number(r.committed ?? 0),
        parked: Number(r.parked ?? 0),
        violations: viol,
        totalEntries: total,
        healthRate: total > 0 ? Math.round(((total - viol) / total) * 100) : 100,
        lastSession: r.last_session
          ? new Date(r.last_session as string).toISOString()
          : null,
      };
    }),
  });
});

router.get("/projects", async (req, res): Promise<void> => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(400).json({ error: "Missing or invalid x-user-id header" });
    return;
  }

  const projects = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId))
    .orderBy(desc(projectsTable.updatedAt));

  let latestScores: Array<{ projectId: number; score: number }> = [];
  try {
    latestScores = await db
      .select({
        projectId: readinessSnapshotsTable.projectId,
        score: readinessSnapshotsTable.score,
      })
      .from(readinessSnapshotsTable)
      .where(
        sql`id IN (
          SELECT DISTINCT ON (project_id) id
          FROM readiness_snapshots
          ORDER BY project_id, recorded_at DESC, id DESC
        )`
      );
  } catch {
    // Table may not exist in test environments — gracefully skip snapshot scores.
  }

  const scoreMap = new Map(latestScores.map(s => [s.projectId, s.score]));

  const projectIds = projects.map(p => p.id);
  let entryStatsMap = new Map<number, { entryCount: number; latestEntryAt: string | null }>();
  if (projectIds.length > 0) {
    const entryStats = await db
      .select({
        projectId: entriesTable.projectId,
        entryCount: sql<number>`count(*)::int`,
        latestEntryAt: sql<string | null>`max(created_at)::text`,
      })
      .from(entriesTable)
      .where(inArray(entriesTable.projectId, projectIds))
      .groupBy(entriesTable.projectId);
    entryStatsMap = new Map(entryStats.map(s => [s.projectId, { entryCount: s.entryCount, latestEntryAt: s.latestEntryAt }]));
  }

  res.json(projects.map(p => ({
    ...serializeProject(p),
    latestSnapshotScore: scoreMap.get(p.id) ?? null,
    entryCount: entryStatsMap.get(p.id)?.entryCount ?? 0,
    latestEntryAt: entryStatsMap.get(p.id)?.latestEntryAt ?? null,
  })));
});

router.get("/entries", async (req, res): Promise<void> => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(400).json({ error: "Missing or invalid x-user-id header" });
    return;
  }

  const rows = await db
    .select({
      id: entriesTable.id,
      projectId: entriesTable.projectId,
      projectName: projectsTable.name,
      title: entriesTable.title,
      summary: entriesTable.summary,
      details: entriesTable.details,
      status: entriesTable.status,
      severity: entriesTable.severity,
      verb: entriesTable.verb,
      supersedesId: entriesTable.supersedesId,
      lockedAt: entriesTable.lockedAt,
      createdAt: entriesTable.createdAt,
      updatedAt: entriesTable.updatedAt,
    })
    .from(entriesTable)
    .innerJoin(projectsTable, eq(entriesTable.projectId, projectsTable.id))
    .where(eq(projectsTable.userId, userId))
    .orderBy(desc(entriesTable.createdAt));

  res.json(rows.map(e => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    lockedAt: e.lockedAt ? e.lockedAt.toISOString() : null,
  })));
});

export default router;
