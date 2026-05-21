import express from "express";
import cookieParser from "cookie-parser";
import healthRouter from "../routes/health";
import projectsRouter from "../routes/projects";
import { requireAuth } from "../routes/auth";

export function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", healthRouter);
  app.use("/api", requireAuth, projectsRouter);
  return app;
}

export const mockUser = {
  id: 1,
  email: "test@axiom.com",
  name: "Test User",
  subscriptionTier: "pro" as const,
  isAdmin: false,
  passwordHash: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const mockProject = {
  id: 42,
  name: "My Project",
  description: null,
  memory: null,
  linkedRepo: null,
  pushHistory: [],
  lastOpenedAt: new Date("2025-01-01"),
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};
