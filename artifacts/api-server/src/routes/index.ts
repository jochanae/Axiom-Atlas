import { Router, type IRouter } from "express";
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
import authRouter, { requireAuth } from "./auth";
import googleAuthRouter from "./google-auth";
import adminRouter from "./admin";
import invitesRouter from "./invites";

const router: IRouter = Router();

// Public routes — no auth required
router.use(authRouter);
router.use(googleAuthRouter);
router.use(adminRouter);
router.use(invitesRouter);
router.use(healthRouter);
router.use(selfRouter);
router.use(devserverRouter);
router.use(importRouter); // cross-origin Axiom handoff — intentionally public, has its own CORS headers

// Protected routes — valid session required
router.use(requireAuth, projectsRouter);
router.use(requireAuth, sessionsRouter);
router.use(requireAuth, entriesRouter);
router.use(requireAuth, chatRouter);
router.use(requireAuth, githubRouter);
router.use(requireAuth, imageRouter);
router.use(requireAuth, thoughtsRouter);
router.use(requireAuth, vaultRouter);

export default router;
