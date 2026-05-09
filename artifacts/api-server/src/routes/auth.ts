import { Router, type IRouter } from "express";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "@workspace/db";
import { usersTable, userSessionsTable } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";

const router: IRouter = Router();
const scryptAsync = promisify(scrypt);

const SUPER_ADMIN_EMAIL = "jochanae@gmail.com";
const SESSION_COOKIE = "atlas-session";
const SESSION_DAYS = 30;

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
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
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

// POST /api/auth/signup
router.post("/auth/signup", async (req, res): Promise<void> => {
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  if (!email || !password) { res.status(400).json({ error: "Email and password are required" }); return; }
  if (password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: "An account with this email already exists" }); return; }

  const passwordHash = await hashPassword(password);
  const role = email.toLowerCase() === SUPER_ADMIN_EMAIL ? "super_admin" : "user";

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
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

// GET /api/auth/me
router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getUserFromCookie(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.json({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, role: user.role, subscriptionTier: user.subscriptionTier });
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

export default router;
