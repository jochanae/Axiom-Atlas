import { Router, type IRouter } from "express";
import { connectionsTable, db } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { oauthStateStore } from "./github";

const router: IRouter = Router();

const GH_API = "https://api.github.com";

function ghHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// GET /api/github/oauth/callback — GitHub redirects here after authorization
// This route is PUBLIC because the browser won't send cookies on a cross-site
// redirect from github.com. The `state` parameter carries the user identity.
router.get("/github/oauth/callback", async (req, res): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;
  const appDomain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "axiomsystem.app";
  const base = `https://${appDomain}`;

  if (error) {
    res.redirect(`${base}/home?github_error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code || !state) {
    res.redirect(`${base}/home?github_error=missing_params`);
    return;
  }

  const stored = oauthStateStore.get(state);
  if (!stored || stored.expiresAt < Date.now()) {
    res.redirect(`${base}/home?github_error=invalid_state`);
    return;
  }
  oauthStateStore.delete(state);
  const { userId } = stored;

  const clientId = process.env.GITHUB_CLIENT_ID!;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET!;

  try {
    // Exchange code for access token
    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenData = await tokenResp.json() as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      console.error("[GitHub OAuth] token exchange failed", tokenData);
      res.redirect(`${base}/home?github_error=token_exchange_failed`);
      return;
    }

    const accessToken = tokenData.access_token;

    // Verify and get the GitHub username
    const ghRes = await fetch(`${GH_API}/user`, { headers: ghHeaders(accessToken), signal: AbortSignal.timeout(8_000) });
    if (!ghRes.ok) {
      res.redirect(`${base}/home?github_error=token_invalid`);
      return;
    }
    const ghUser = await ghRes.json() as { login?: string };
    const username = ghUser.login ?? "GitHub";

    // Encrypt and upsert into connections table — same as the PAT flow
    const { encryptToken } = await import("../lib/tokenCrypto");
    const encrypted = encryptToken(accessToken);

    const existing = await db
      .select({ id: connectionsTable.id })
      .from(connectionsTable)
      .where(and(eq(connectionsTable.userId, userId), eq(connectionsTable.type, "github")))
      .orderBy(desc(connectionsTable.createdAt));

    if (existing.length > 0) {
      const [keep, ...dupes] = existing;
      for (const dupe of dupes) {
        await db.delete(connectionsTable).where(and(eq(connectionsTable.id, dupe.id), eq(connectionsTable.userId, userId)));
      }
      await db.update(connectionsTable)
        .set({ token: encrypted, label: username, url: `https://github.com/${username}`, status: "linked", lastCheckedAt: new Date() })
        .where(and(eq(connectionsTable.id, keep.id), eq(connectionsTable.userId, userId)));
    } else {
      await db.insert(connectionsTable).values({
        userId,
        type: "github",
        label: username,
        url: `https://github.com/${username}`,
        token: encrypted,
        status: "linked",
      });
    }

    res.redirect(`${base}/home?github_connected=true&github_user=${encodeURIComponent(username)}`);
  } catch (err) {
    console.error("[GitHub OAuth] callback error", err);
    res.redirect(`${base}/home?github_error=server_error`);
  }
});

export default router;
