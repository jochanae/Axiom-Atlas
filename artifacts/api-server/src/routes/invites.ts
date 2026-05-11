import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { invitesTable, usersTable } from "@workspace/db/schema";
import { eq, desc, isNull } from "drizzle-orm";
import { getUserFromCookie } from "./auth";

const router: IRouter = Router();

async function requireSuperAdmin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): Promise<void> {
  const user = await getUserFromCookie(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (user.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }
  next();
}

// GET /api/admin/invites — list all invites
router.get("/admin/invites", requireSuperAdmin, async (_req, res): Promise<void> => {
  const invites = await db
    .select({
      id: invitesTable.id,
      email: invitesTable.email,
      token: invitesTable.token,
      createdAt: invitesTable.createdAt,
      acceptedAt: invitesTable.acceptedAt,
      invitedByName: usersTable.name,
      invitedByEmail: usersTable.email,
    })
    .from(invitesTable)
    .leftJoin(usersTable, eq(invitesTable.invitedById, usersTable.id))
    .orderBy(desc(invitesTable.createdAt));
  res.json(invites);
});

// POST /api/admin/invites — create invite
router.post("/admin/invites", requireSuperAdmin, async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };
  if (!email?.trim()) { res.status(400).json({ error: "Email is required" }); return; }

  const user = await getUserFromCookie(req);
  const token = randomBytes(24).toString("hex");

  // Check if already invited and pending
  const existing = await db
    .select({ id: invitesTable.id, acceptedAt: invitesTable.acceptedAt })
    .from(invitesTable)
    .where(eq(invitesTable.email, email.toLowerCase().trim()))
    .orderBy(desc(invitesTable.createdAt))
    .limit(1);

  if (existing[0] && !existing[0].acceptedAt) {
    res.status(409).json({ error: "An invite is already pending for this email" });
    return;
  }

  const [invite] = await db.insert(invitesTable).values({
    email: email.toLowerCase().trim(),
    token,
    invitedById: user?.id ?? null,
  }).returning();

  res.status(201).json(invite);
});

// DELETE /api/admin/invites/:id — cancel invite
router.delete("/admin/invites/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(invitesTable).where(eq(invitesTable.id, id));
  res.json({ ok: true });
});

// GET /api/invite/:token — public: verify an invite token
router.get("/invite/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const [invite] = await db
    .select()
    .from(invitesTable)
    .where(eq(invitesTable.token, token))
    .limit(1);

  if (!invite) { res.status(404).json({ error: "Invite not found" }); return; }
  if (invite.acceptedAt) { res.status(410).json({ error: "Invite already used" }); return; }

  res.json({ email: invite.email, token: invite.token });
});

// POST /api/invite/:token/accept — mark invite as accepted (called at signup)
router.post("/invite/:token/accept", async (req, res): Promise<void> => {
  const { token } = req.params;
  const [updated] = await db
    .update(invitesTable)
    .set({ acceptedAt: new Date() })
    .where(eq(invitesTable.token, token))
    .returning();

  if (!updated) { res.status(404).json({ error: "Invite not found" }); return; }
  res.json({ ok: true });
});

export default router;
