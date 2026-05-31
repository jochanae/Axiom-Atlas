import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import healthRouter from "./health";
import projectsRouter from "./projects";
import sessionsRouter from "./sessions";
import entriesRouter from "./entries";
import chatRouter from "./chat";
import githubRouter from "./github";
import imageRouter from "./image";
import devserverRouter from "./devserver";
import selfRouter from "./self";
import thoughtsRouter from "./thoughts";
import importRouter from "./import";
import vaultRouter from "./vault";
import secretsRouter from "./secrets";
import forgeRouter from "./forge";
import authRouter, { requireAuth, requireAdmin } from "./auth";
import googleAuthRouter from "./google-auth";
import adminRouter from "./admin";
import invitesRouter from "./invites";
import stripeRouter from "./stripe";
import statsRouter from "./stats";
import nexusRouter from "./nexus";
import terminalRouter from "./terminal";
import galleryRouter from "./gallery";
import storageRouter from "./storage";
import errorlogRouter from "./errorlog";
import cloudlogsRouter from "./cloudlogs";
import selfmapRouter from "./selfmap";
import forgeStateRouter from "./forge-state";
import serverApiRouter from "./server-api";
import tensionsRouter from "./tensions";
import scanRouter from "./scan";
import blueprintRouter from "./blueprint";
import connectionsRouter from "./connections";
import mcpRouter from "./mcp";
import stateRouter from "./state";
import uploadRouter from "./upload";
import artifactsRouter from "./artifacts";
import mentalShredderRouter from "./mental-shredder";
import jobsRouter from "./jobs";
import { supabaseAuth } from "../middleware/supabaseAuth";

// Supabase URL for JWT validation
// process.env.SUPABASE_URL should be set in 
// Cloud Run environment variables

const router: IRouter = Router();

// Fully public — no auth
router.get("/auth/me", supabaseAuth, async (req: any, res: any) => {
  const { supabaseId, email } = req.supabaseUser;
  
  try {
    const rows = await db.execute(sql`
      SELECT * FROM users 
      WHERE supabase_id = ${supabaseId} 
        OR email = ${email}
      LIMIT 1
    `);

    if (!rows.rows[0]) {
      const created = await db.execute(sql`
        INSERT INTO users (supabase_id, email)
        VALUES (${supabaseId}, ${email})
        ON CONFLICT (email) 
        DO UPDATE SET 
          supabase_id = EXCLUDED.supabase_id
        RETURNING *
      `);
      return res.json(created.rows[0]);
    }

    res.json(rows.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
router.use(stripeRouter);
router.use(authRouter);
router.use(googleAuthRouter);
router.use(healthRouter);
router.use(errorlogRouter);
router.use("/server", serverApiRouter);

// Invite redemption is public so users can sign up via invite link
router.use(invitesRouter);

// Admin panel — behind requireAuth, admin check is enforced inside adminRouter
router.use(requireAuth, adminRouter);

// Protected — valid session required
router.use("/projects/tensions", requireAuth, tensionsRouter);
router.use(requireAuth, projectsRouter);
router.use(requireAuth, sessionsRouter);
router.use(requireAuth, entriesRouter);
router.use(requireAuth, chatRouter);
router.use(requireAuth, githubRouter);
router.use(requireAuth, imageRouter);
router.use(requireAuth, thoughtsRouter);
router.use(requireAuth, vaultRouter);
router.use(requireAuth, secretsRouter);
router.use(requireAuth, forgeRouter);
router.use(requireAuth, forgeStateRouter);
router.use(requireAuth, devserverRouter);
router.use(requireAuth, importRouter);
router.use(requireAuth, selfmapRouter);
router.use(requireAuth, scanRouter);
router.use(requireAuth, blueprintRouter);
router.use(requireAuth, connectionsRouter);
router.use(requireAuth, mcpRouter);
router.use(requireAuth, stateRouter);
router.use(requireAuth, jobsRouter);

// Stats
router.use(requireAuth, statsRouter);

// Nexus — global command space (mode, not a project)
router.use(requireAuth, nexusRouter);

// Gallery — visual vault (global + per-project)
router.use(requireAuth, galleryRouter);

// Object storage — presigned URL upload + serve
router.use(storageRouter);

// Terminal — command execution with streaming output
router.use(requireAuth, terminalRouter);

// Zip upload → code context extraction
router.use(requireAuth, uploadRouter);

router.use(requireAuth, artifactsRouter);
router.use(requireAuth, mentalShredderRouter);

// Self-repair routes — super_admin only
router.use(requireAdmin, selfRouter);
router.use(requireAdmin, cloudlogsRouter);

export default router;
