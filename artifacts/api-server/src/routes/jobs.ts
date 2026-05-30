import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

// Raw query helpers since agentJobsTable may not be in 
// schema yet — using sql`` directly against Neon
async function insertJob(userId: number, projectId: number | null, sessionId: number | null, type: string, input: object) {
  const rows = await db.execute(sql`
    INSERT INTO agent_jobs (user_id, project_id, session_id, type, status, input)
    VALUES (${userId}, ${projectId}, ${sessionId}, ${type}, 'queued', ${JSON.stringify(input)}::jsonb)
    RETURNING id, type, status, created_at
  `);
  return rows.rows[0];
}

async function getJob(jobId: number, userId: number) {
  const rows = await db.execute(sql`
    SELECT id, type, status, input, output, error, 
           started_at, completed_at, created_at
    FROM agent_jobs
    WHERE id = ${jobId} AND user_id = ${userId}
  `);
  return rows.rows[0] ?? null;
}

async function listJobs(userId: number, projectId?: number) {
  if (projectId) {
    const rows = await db.execute(sql`
      SELECT id, type, status, input, output, error,
             started_at, completed_at, created_at
      FROM agent_jobs
      WHERE user_id = ${userId} AND project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT 20
    `);
    return rows.rows;
  }
  const rows = await db.execute(sql`
    SELECT id, type, status, input, output, error,
           started_at, completed_at, created_at
    FROM agent_jobs
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 20
  `);
  return rows.rows;
}

async function processJob(jobId: number, userId: number) {
  // Mark as running
  await db.execute(sql`
    UPDATE agent_jobs 
    SET status = 'running', started_at = now()
    WHERE id = ${jobId} AND user_id = ${userId}
  `);

  const job = await getJob(jobId, userId);
  if (!job) return;

  try {
    const input = job.input as any;
    let output: object = {};

    if (job.type === "scan") {
      // Trigger project scan
      const res = await fetch(
        `http://localhost:${process.env.PORT ?? 3000}/api/projects/${input.projectId}/scan`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "github" }) }
      );
      output = res.ok ? await res.json() as object : { error: `Scan failed: ${res.status}` };
    } else if (job.type === "selfmap") {
      const { buildSelfMap } = await import("./selfmap");
      const result = await buildSelfMap();
      output = { file_count: result.file_count, created_at: result.created_at.toISOString() };
    } else if (job.type === "blueprint") {
      output = { message: "Blueprint job queued — run from workspace Blueprints tab" };
    } else {
      output = { message: `Job type "${job.type as string}" processed` };
    }

    await db.execute(sql`
      UPDATE agent_jobs
      SET status = 'completed', output = ${JSON.stringify(output)}::jsonb, completed_at = now()
      WHERE id = ${jobId}
    `);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    await db.execute(sql`
      UPDATE agent_jobs
      SET status = 'failed', error = ${error}, completed_at = now()
      WHERE id = ${jobId}
    `);
  }
}

// POST /api/jobs — enqueue a new job
router.post("/jobs", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { type, projectId, sessionId, input = {} } = req.body as {
    type: string;
    projectId?: number;
    sessionId?: number;
    input?: object;
  };

  if (!type) { res.status(400).json({ error: "type is required" }); return; }

  const job = await insertJob(userId, projectId ?? null, sessionId ?? null, type, input);

  // Process async — don't await
  void processJob(job.id as number, userId);

  res.status(202).json({ job });
});

// GET /api/jobs — list jobs for current user
router.get("/jobs", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  const jobs = await listJobs(userId, projectId);
  res.json(jobs);
});

// GET /api/jobs/:id — get single job status
router.get("/jobs/:id", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const jobId = Number(req.params.id);
  if (!jobId) { res.status(400).json({ error: "Invalid job id" }); return; }

  const job = await getJob(jobId, userId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  res.json(job);
});

export default router;
