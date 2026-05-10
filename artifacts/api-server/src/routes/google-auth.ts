import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { usersTable, userSessionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const SESSION_COOKIE = "atlas-session";
const SESSION_DAYS = 90;
// Super-admin email from env only — no hardcoded fallback
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL?.toLowerCase() ?? "";

function getRedirectUri(req?: import("express").Request) {
  // Use the actual host from the incoming request so dev and prod both work
  // without needing separate Google Console entries per environment
  if (req) {
    const forwarded = req.headers["x-forwarded-host"];
    const host = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || req.headers.host;
    if (host) return `https://${host}/api/auth/google/callback`;
  }
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) return `https://${domain}/api/auth/google/callback`;
  return `http://localhost:80/api/auth/google/callback`;
}

// GET /api/auth/google/redirect-uri — diagnostic: returns the exact URI to register in Google Console
router.get("/auth/google/redirect-uri", (req, res): void => {
  res.json({ redirectUri: getRedirectUri(req) });
});

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
// Pass ?link=1 when user is already signed in and wants to link Google to their account.
router.get("/auth/google", (req, res): void => {
  const state = randomBytes(16).toString("hex");
  const isLink = req.query.link === "1";

  res.cookie("oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600_000, path: "/" });

  // If linking, carry the existing session token so the callback can find the user
  if (isLink) {
    const existingSession = req.cookies?.[SESSION_COOKIE];
    if (existingSession) {
      res.cookie("oauth_link_session", existingSession, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600_000, path: "/" });
    }
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: getRedirectUri(req),
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
  const linkSessionToken = req.cookies?.oauth_link_session as string | undefined;

  res.clearCookie("oauth_state", { path: "/" });
  res.clearCookie("oauth_link_session", { path: "/" });

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
        redirect_uri: getRedirectUri(req),
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

    // ── Link flow: user was already signed in and clicked "Link Google" ──────
    if (linkSessionToken) {
      const now = new Date();
      const rows = await db
        .select({ user: usersTable })
        .from(userSessionsTable)
        .innerJoin(usersTable, eq(userSessionsTable.userId, usersTable.id))
        .where(eq(userSessionsTable.token, linkSessionToken))
        .limit(1);
      const existingUser = rows[0]?.user;
      if (existingUser) {
        // Check the Google ID isn't already on a different account
        const googleOwner = (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.googleId, profile.id)).limit(1))[0];
        if (googleOwner && googleOwner.id !== existingUser.id) {
          res.redirect("/home?link_error=google_used_by_another_account");
          return;
        }
        await db.update(usersTable).set({
          googleId: profile.id,
          ...(existingUser.avatarUrl ? {} : { avatarUrl: profile.picture ?? null }),
        }).where(eq(usersTable.id, existingUser.id));
        res.redirect("/home?linked=google");
        return;
      }
    }

    // ── Normal sign-in / sign-up flow ────────────────────────────────────────
    let user = (await db.select().from(usersTable).where(eq(usersTable.googleId, profile.id)).limit(1))[0];

    if (user) {
      // Existing Google user — always refresh avatarUrl so stale photos self-heal on every login
      if (profile.picture && user.avatarUrl !== profile.picture) {
        [user] = await db.update(usersTable).set({ avatarUrl: profile.picture }).where(eq(usersTable.id, user.id)).returning();
      }
    }

    if (!user) {
      // Check if an email/password account already exists — if so, link Google to it.
      // Google has verified email ownership so this is safe.
      const existing = (await db.select().from(usersTable).where(eq(usersTable.email, profile.email.toLowerCase())).limit(1))[0];
      if (existing) {
        [user] = await db
          .update(usersTable)
          .set({
            googleId: profile.id,
            // Always sync the Google photo when linking — overwrite any stale URL
            avatarUrl: profile.picture ?? existing.avatarUrl ?? null,
          })
          .where(eq(usersTable.id, existing.id))
          .returning();
      } else {
        const role = (SUPER_ADMIN_EMAIL && profile.email.toLowerCase() === SUPER_ADMIN_EMAIL) ? "super_admin" : "user";
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
