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

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(sessionsRouter);
router.use(entriesRouter);
router.use(chatRouter);
router.use(githubRouter);
router.use(imageRouter);
router.use(devserverRouter);
router.use(selfRouter);
router.use(thoughtsRouter);
router.use(importRouter);

export default router;
