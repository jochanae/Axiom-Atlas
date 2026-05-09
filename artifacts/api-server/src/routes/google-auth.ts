import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { usersTable, userSessionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const SESSION_COOKIE = "atlas-session";
const SESSION_DAYS = 30;
const SUPER_ADMIN_EMAIL = "jochanae@gmail.com";

function getRedirectUri() {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) return `https://${domain}/api/auth/google/callback`;
  return `http://localhost:80/api/auth/google/callback`;
}

function createSessionCookie(token: string, res: import("express").Response) {
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    expires,
    path: "/",
  });
}

// GET /api/auth/google — redirect to Google consent screen
router.get("/auth/google", (req, res): void => {
  const state = randomBytes(16).toString("hex");
  res.cookie("oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600_000, path: "/" });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback — exchange code for user info
router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;
  const storedState = req.cookies?.oauth_state;
  res.clearCookie("oauth_state", { path: "/" });

  if (error || !code) {
    res.redirect("/?auth_error=" + encodeURIComponent(error ?? "no_code"));
    return;
  }

  if (!state || state !== storedState) {
    res.redirect("/?auth_error=state_mismatch");
    return;
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: getRedirectUri(),
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokens.access_token) {
      res.redirect("/?auth_error=token_exchange_failed");
      return;
    }

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json() as { id?: string; email?: string; name?: string; picture?: string };

    if (!profile.id || !profile.email) {
      res.redirect("/?auth_error=missing_profile");
      return;
    }

    // Find or create user
    let user = (await db.select().from(usersTable).where(eq(usersTable.googleId, profile.id)).limit(1))[0];

    if (!user) {
      // Check if email already exists (email/password user linking)
      const existing = (await db.select().from(usersTable).where(eq(usersTable.email, profile.email.toLowerCase())).limit(1))[0];
      if (existing) {
        // Link Google ID to existing account
        [user] = await db.update(usersTable)
          .set({ googleId: profile.id, avatarUrl: existing.avatarUrl ?? profile.picture ?? null })
          .where(eq(usersTable.id, existing.id))
          .returning();
      } else {
        // Create new user
        const role = profile.email.toLowerCase() === SUPER_ADMIN_EMAIL ? "super_admin" : "user";
        [user] = await db.insert(usersTable).values({
          email: profile.email.toLowerCase(),
          googleId: profile.id,
          name: profile.name ?? null,
          avatarUrl: profile.picture ?? null,
          role,
          subscriptionTier: role === "super_admin" ? "founder" : "free",
        }).returning();
      }
    }

    if (!user) {
      res.redirect("/?auth_error=user_create_failed");
      return;
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await db.insert(userSessionsTable).values({ userId: user.id, token, expiresAt });

    createSessionCookie(token, res);
    res.redirect("/home");
  } catch (err) {
    req.log?.error(err, "google-oauth-callback-error");
    res.redirect("/?auth_error=server_error");
  }
});

export default router;
