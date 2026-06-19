import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import sessionsRouter from "./sessions";
import entriesRouter from "./entries";
import generationRouter from "./generation";
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
import githubOAuthPublicRouter from "./github-oauth-public";
import adminRouter from "./admin";
import invitesRouter from "./invites";
import stripeRouter from "./stripe";
import statsRouter from "./stats";
import nexusRouter from "./nexus";
import terminalRouter from "./terminal";
import galleryRouter from "./gallery";
import storageRouter from "./storage";
import errorlogRouter from "./errorlog";
import selfmapRouter from "./selfmap";
import forgeStateRouter from "./forge-state";
import serverApiRouter from "./server-api";
import tensionsRouter from "./tensions";
import scanRouter from "./scan";
import blueprintRouter from "./blueprint";
import genomeRouter from "./genome";
import connectionsRouter from "./connections";
import mcpRouter from "./mcp";
import stateRouter from "./state";
import imagineRouter from "./imagine";
import previewRouter from "./preview";
import artifactsRouter from "./artifacts";
import manifestRouter from "./manifest";
import codegenRouter from "./codegen";
import errorsRouter from "./errors";
import browserRouter from "./browser";
import deployRouter from "./deploy";

const router: IRouter = Router();

// Fully public — no auth
router.use(stripeRouter);
router.use(authRouter);
router.use(googleAuthRouter);
router.use(githubOAuthPublicRouter);  // GitHub OAuth callback must be public (cross-site redirect drops cookies)
router.use(healthRouter);
router.use(errorlogRouter);
router.use("/server", serverApiRouter);
router.use(errorsRouter);

// Invite redemption is public so users can sign up via invite link
router.use(invitesRouter);

// Admin panel — behind requireAuth, admin check is enforced inside adminRouter
router.use(requireAuth, adminRouter);

// Protected — valid session required
router.use(requireAuth, projectsRouter);
router.use(requireAuth, sessionsRouter);
router.use(requireAuth, entriesRouter);
router.use(requireAuth, generationRouter);
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
router.use(requireAuth, tensionsRouter);
router.use(requireAuth, scanRouter);
router.use(requireAuth, blueprintRouter);
router.use(requireAuth, genomeRouter);
router.use(requireAuth, connectionsRouter);
router.use(requireAuth, mcpRouter);
router.use(requireAuth, stateRouter);
router.use(requireAuth, artifactsRouter);
router.use(requireAuth, codegenRouter);
router.use(requireAuth, browserRouter);
router.use(requireAuth, deployRouter);

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

// Image generation — Imagen 3 (primary) / DALL·E 3 (fallback)
router.use(requireAuth, imagineRouter);
router.use(requireAuth, previewRouter);
router.use(requireAuth, manifestRouter);

// Self-repair routes — super_admin only
router.use(requireAdmin, selfRouter);

export default router;
