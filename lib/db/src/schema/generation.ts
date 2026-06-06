import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const generationRuns = pgTable("generation_runs", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id").notNull(),
  prompt: text("prompt").notNull(),
  intent: text("intent").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  filesChanged: integer("files_changed").notNull().default(0),
  linesAdded: integer("lines_added").notNull().default(0),
  linesRemoved: integer("lines_removed").notNull().default(0),
  summary: text("summary").notNull().default(""),
  commitSha: text("commit_sha"),
  pushedToBranch: text("pushed_to_branch"),
});

export const generatedFiles = pgTable("generated_files", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  path: text("path").notNull(),
  language: text("language").notNull(),
  bytes: integer("bytes").notNull(),
  lines: integer("lines").notNull(),
  content: text("content").notNull(),
  previousContent: text("previous_content"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
