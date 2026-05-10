import { Router, type IRouter } from "express";
import { sql, desc, and, eq, gte, inArray } from "drizzle-orm";
import { db, projectsTable, sessionsTable, entriesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/stats/dashboard", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
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

  // Build a PostgreSQL array literal for the raw-SQL aggregate queries.
  // projectIds are integer DB primary keys — not user input.
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

export default router;
