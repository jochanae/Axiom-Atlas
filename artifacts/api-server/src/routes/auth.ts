import { Router, type IRouter } from "express";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "@workspace/db";
import { usersTable, userSessionsTable } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { Resend } from "resend";

const router: IRouter = Router();
const scryptAsync = promisify(scrypt);

// ── In-memory rate limiter ────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Super-admin email from env only — no hardcoded fallback
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL?.toLowerCase() ?? "";

const SESSION_COOKIE = "atlas-session";
const SESSION_DAYS = 90;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [hashed, salt] = hash.split(".");
  if (!hashed || !salt) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const hashedBuf = Buffer.from(hashed, "hex");
  if (buf.length !== hashedBuf.length) return false;
  return timingSafeEqual(buf, hashedBuf);
}

function createSessionCookie(token: string, res: import("express").Response) {
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    expires,
    path: "/",
  });
}

export async function getUserFromCookie(req: import("express").Request) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const now = new Date();
  const rows = await db
    .select({ user: usersTable })
    .from(userSessionsTable)
    .innerJoin(usersTable, eq(userSessionsTable.userId, usersTable.id))
    .where(and(eq(userSessionsTable.token, token), gt(userSessionsTable.expiresAt, now)))
    .limit(1);
  return rows[0]?.user ?? null;
}

// GET /api/auth/session/exchange
router.get("/auth/session/exchange", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : undefined;
  if (!token) { res.status(400).json({ error: "Token is required" }); return; }

  const now = new Date();
  const [session] = await db
    .select({ id: userSessionsTable.id })
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.token, token), gt(userSessionsTable.expiresAt, now)))
    .limit(1);

  if (!session) { res.status(401).json({ error: "Invalid or expired token" }); return; }

  createSessionCookie(token, res);
  res.json({ ok: true });
});

// POST /api/auth/signup
router.post("/auth/signup", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) { res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." }); return; }

  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  if (!email || !password) { res.status(400).json({ error: "Email and password are required" }); return; }
  if (password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: "An account with this email already exists" }); return; }

  const passwordHash = await hashPassword(password);
  // Only grant super_admin if SUPER_ADMIN_EMAIL env var is explicitly set and matches
  const role = (SUPER_ADMIN_EMAIL && email.toLowerCase() === SUPER_ADMIN_EMAIL) ? "super_admin" : "user";

  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase(),
    passwordHash,
    name: name?.trim() || null,
    role,
    subscriptionTier: role === "super_admin" ? "founder" : "free",
  }).returning();

  if (!user) { res.status(500).json({ error: "Failed to create account" }); return; }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(userSessionsTable).values({ userId: user.id, token, expiresAt });

  createSessionCookie(token, res);
  res.status(201).json({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, role: user.role, subscriptionTier: user.subscriptionTier });
});

// POST /api/auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) { res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." }); return; }

  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) { res.status(400).json({ error: "Email and password are required" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (!user || !user.passwordHash) { res.status(401).json({ error: "Invalid email or password" }); return; }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "Invalid email or password" }); return; }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(userSessionsTable).values({ userId: user.id, token, expiresAt });

  createSessionCookie(token, res);
  res.json({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, role: user.role, subscriptionTier: user.subscriptionTier });
});

// POST /api/auth/logout
router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    await db.delete(userSessionsTable).where(eq(userSessionsTable.token, token)).catch(() => {});
  }
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "none", path: "/" });
  res.json({ ok: true });
});

// POST /api/auth/forgot-password
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };
  if (!email) { res.status(400).json({ error: "Email is required" }); return; }

  const [user] = await db.select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);

  if (user) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await db.update(usersTable).set({ resetToken: token, resetTokenExpiresAt: expiresAt }).where(eq(usersTable.id, user.id));
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "Axiom <onboarding@resend.dev>",
        to: email,
        subject: "Reset your Axiom password",
        html: `<p>You requested a password reset for your Axiom account.</p><p><a href="${process.env.APP_URL ?? "https://axiomsystem.app"}/reset-password?token=${token}">Click here to reset your password</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
      });
    }
  }

  res.json({ ok: true, message: "Password reset link will be sent to your email" });
});

// POST /api/auth/reset-password
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) { res.status(400).json({ error: "Token and password are required" }); return; }
  if (password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  const [userByToken] = await db
    .select({ id: usersTable.id, email: usersTable.email, resetTokenExpiresAt: usersTable.resetTokenExpiresAt })
    .from(usersTable)
    .where(eq(usersTable.resetToken, token))
    .limit(1);

  if (!userByToken || !userByToken.resetTokenExpiresAt || Date.now() > userByToken.resetTokenExpiresAt.getTime()) {
    res.status(400).json({ error: "Reset link is invalid or has expired" }); return;
  }

  const passwordHash = await hashPassword(password);
  await db.update(usersTable)
    .set({ passwordHash, resetToken: null, resetTokenExpiresAt: null })
    .where(eq(usersTable.id, userByToken.id));

  // Invalidate ALL existing sessions so stolen sessions can't be reused after a password reset
  await db.delete(userSessionsTable).where(eq(userSessionsTable.userId, userByToken.id));

  res.json({ ok: true });
});

// GET /api/auth/me
router.get("/auth/me", async (req, res): Promise<void> => {
  try {
    const user = await getUserFromCookie(req);
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
    res.json({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, role: user.role, subscriptionTier: user.subscriptionTier, terminalSafety: user.terminalSafety, googleLinked: !!user.googleId, hasPassword: !!user.passwordHash });
  } catch (err: any) {
    console.error("auth/me error:", err);
    res.status(401).json({ error: "Session invalid" });
    return;
  }
});

// PATCH /api/auth/profile — update own name and/or avatarUrl
router.patch("/auth/profile", async (req, res): Promise<void> => {
  const user = await getUserFromCookie(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { name, avatarUrl } = req.body as { name?: string | null; avatarUrl?: string | null };
  const updates: Partial<{ name: string | null; avatarUrl: string | null }> = {};
  if (name !== undefined) updates.name = name?.trim() || null;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl || null;

  if (Object.keys(updates).length === 0) { res.json({ ok: true }); return; }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id)).returning();
  res.json({ id: updated.id, name: updated.name, avatarUrl: updated.avatarUrl });
});

// PATCH /api/auth/change-password — change own password (requires current password)
router.patch("/auth/change-password", async (req, res): Promise<void> => {
  const user = await getUserFromCookie(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!user.passwordHash) { res.status(400).json({ error: "No password set on this account" }); return; }

  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) { res.status(400).json({ error: "Current and new password are required" }); return; }
  if (newPassword.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }

  const newHash = await hashPassword(newPassword);
  await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, user.id));
  res.json({ ok: true });
});

// DELETE /api/auth/account — permanently delete own account
router.delete("/auth/account", async (req, res): Promise<void> => {
  const user = await getUserFromCookie(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }

  await db.delete(usersTable).where(eq(usersTable.id, user.id));
  res.clearCookie("atlas-session", { httpOnly: true, secure: true, sameSite: "none", path: "/" });
  res.json({ ok: true });
});

// Middleware: require a valid session cookie — attaches authUser to req
export async function requireAuth(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
): Promise<void> {
  const user = await getUserFromCookie(req);
  if (!user) { res.status(401).json({ error: "Authentication required" }); return; }
  (req as any).authUser = user;
  next();
}

// Middleware: require super_admin role
export async function requireAdmin(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
): Promise<void> {
  const user = await getUserFromCookie(req);
  if (!user) { res.status(401).json({ error: "Authentication required" }); return; }
  if (user.role !== "super_admin") { res.status(403).json({ error: "Admin access required" }); return; }
  (req as any).authUser = user;
  next();
}

// GET /api/auth/dev-test-login — DEV ONLY: creates a fresh test account and sets session cookie
// Blocked in production. Used by automated e2e tests to bypass OAuth UI.
router.get("/auth/dev-test-login", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const ts = Date.now();
  const email = `e2e-auto-${ts}@test.internal`;
  const rawPassword = "E2eTestPass999!";
  const passwordHash = await hashPassword(rawPassword);

  const [user] = await db.insert(usersTable).values({
    email,
    passwordHash,
    name: "E2E Test User",
    role: "user",
    subscriptionTier: "free",
  }).returning();

  if (!user) { res.status(500).json({ error: "Failed to create test user" }); return; }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(userSessionsTable).values({ userId: user.id, token, expiresAt });

  createSessionCookie(token, res);
  // Redirect straight to the home page so the browser lands authenticated
  res.redirect("/home");
});

export default router;
