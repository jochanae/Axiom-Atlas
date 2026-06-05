import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const generationRunsTable = pgTable("generation_runs", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  intent: text("intent").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  filesChanged: integer("files_changed").default(0),
  linesAdded: integer("lines_added").default(0),
  linesRemoved: integer("lines_removed").default(0),
  summary: text("summary").default(""),
  commitSha: text("commit_sha"),
  pushedToBranch: text("pushed_to_branch"),
});

export const generatedFilesTable = pgTable("generated_files", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => generationRunsTable.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  language: text("language").notNull(),
  bytes: integer("bytes").notNull(),
  lines: integer("lines").notNull(),
  content: text("content").notNull(),
  previousContent: text("previous_content"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GenerationRun = typeof generationRunsTable.$inferSelect;
export type GeneratedFile = typeof generatedFilesTable.$inferSelect;
