import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@workspace/db";
import {
  usersTable,
  userSessionsTable,
  adminNotesTable,
  errorLogsTable,
} from "@workspace/db/schema";
import { eq, desc, count } from "drizzle-orm";
import { getUserFromCookie } from "./auth";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router: IRouter = Router();

async function requireSuperAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getUserFromCookie(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (user.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }
  next();
}

// ── Stats ──────────────────────────────────────────────────────────────────────
router.get("/admin/stats", requireSuperAdmin, async (_req, res): Promise<void> => {
  const [userCount] = await db.select({ count: count() }).from(usersTable);
  const [errorCount] = await db.select({ count: count() }).from(errorLogsTable).where(eq(errorLogsTable.resolved, false));
  const [noteCount] = await db.select({ count: count() }).from(adminNotesTable);

  const tierBreakdown = await db
    .select({ tier: usersTable.subscriptionTier, count: count() })
    .from(usersTable)
    .groupBy(usersTable.subscriptionTier);

  res.json({
    users: userCount?.count ?? 0,
    unresolvedErrors: errorCount?.count ?? 0,
    notes: noteCount?.count ?? 0,
    tierBreakdown,
  });
});

// ── Users ──────────────────────────────────────────────────────────────────────
router.get("/admin/users", requireSuperAdmin, async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
      role: usersTable.role,
      subscriptionTier: usersTable.subscriptionTier,
      googleId: usersTable.googleId,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));

  res.json(users.map(u => ({ ...u, projectCount: 0 })));
});

router.patch("/admin/users/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const { subscriptionTier, role, name } = req.body as {
    subscriptionTier?: string;
    role?: string;
    name?: string;
  };

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (subscriptionTier !== undefined) updates.subscriptionTier = subscriptionTier;
  if (role !== undefined) updates.role = role;
  if (name !== undefined) updates.name = name;

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }

  res.json({ id: updated.id, email: updated.email, role: updated.role, subscriptionTier: updated.subscriptionTier });
});

router.delete("/admin/users/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  await db.delete(userSessionsTable).where(eq(userSessionsTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ ok: true });
});

// ── Notes ──────────────────────────────────────────────────────────────────────
router.get("/admin/notes", requireSuperAdmin, async (_req, res): Promise<void> => {
  const notes = await db.select().from(adminNotesTable).orderBy(desc(adminNotesTable.createdAt));
  res.json(notes);
});

router.post("/admin/notes", requireSuperAdmin, async (req, res): Promise<void> => {
  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: "Content is required" }); return; }
  const [note] = await db.insert(adminNotesTable).values({ content: content.trim() }).returning();
  res.status(201).json(note);
});

router.delete("/admin/notes/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid note id" }); return; }
  await db.delete(adminNotesTable).where(eq(adminNotesTable.id, id));
  res.json({ ok: true });
});

// ── Error Logs ─────────────────────────────────────────────────────────────────
// POST is public — called by client-side error boundaries
router.post("/admin/errors", async (req, res): Promise<void> => {
  const { message, stack, url, context } = req.body as {
    message?: string;
    stack?: string;
    url?: string;
    context?: string;
  };
  if (!message) { res.status(400).json({ error: "message is required" }); return; }
  const user = await getUserFromCookie(req);
  const [entry] = await db.insert(errorLogsTable).values({
    message,
    stack: stack ?? null,
    url: url ?? null,
    userId: user?.id ?? null,
    context: context ?? null,
  }).returning();
  res.status(201).json(entry);
});

router.get("/admin/errors", requireSuperAdmin, async (_req, res): Promise<void> => {
  const errors = await db
    .select({
      id: errorLogsTable.id,
      message: errorLogsTable.message,
      stack: errorLogsTable.stack,
      url: errorLogsTable.url,
      context: errorLogsTable.context,
      resolved: errorLogsTable.resolved,
      adminResponse: errorLogsTable.adminResponse,
      createdAt: errorLogsTable.createdAt,
      userId: errorLogsTable.userId,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(errorLogsTable)
    .leftJoin(usersTable, eq(errorLogsTable.userId, usersTable.id))
    .orderBy(desc(errorLogsTable.createdAt));
  res.json(errors);
});

router.patch("/admin/errors/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { resolved, adminResponse } = req.body as { resolved?: boolean; adminResponse?: string };
  const updates: Record<string, unknown> = {};
  if (resolved !== undefined) updates.resolved = resolved;
  if (adminResponse !== undefined) updates.adminResponse = adminResponse;
  const [updated] = await db.update(errorLogsTable).set(updates).where(eq(errorLogsTable.id, id)).returning();
  res.json(updated);
});

router.delete("/admin/errors/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(errorLogsTable).where(eq(errorLogsTable.id, id));
  res.json({ ok: true });
});

// POST /api/admin/sync-frontend — pull latest frontend from GitHub (super_admin only)
router.post("/admin/sync-frontend", requireSuperAdmin, async (_req, res): Promise<void> => {
  try {
    // process.cwd() = artifacts/api-server; workspace root is two levels up
    const workspaceRoot = path.resolve(process.cwd(), "../..");
    const { stdout, stderr } = await execAsync("bash scripts/sync-frontend.sh", {
      cwd: workspaceRoot,
      timeout: 120_000,
      env: { ...process.env, HOME: process.env.HOME ?? "/root" },
    });
    res.json({ success: true, output: stdout, errors: stderr });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    res.status(500).json({
      success: false,
      output: e.stdout ?? "",
      errors: e.stderr ?? e.message ?? "Unknown error",
    });
  }
});

export default router;
