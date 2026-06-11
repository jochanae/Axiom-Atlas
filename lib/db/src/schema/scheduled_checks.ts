import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const scheduledChecksTable = pgTable("scheduled_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }).notNull(),
  url: text("url").notNull(),
  intervalMinutes: integer("interval_minutes").notNull().default(1440),
  isActive: boolean("is_active").notNull().default(true),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const checkResultsTable = pgTable("check_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduleId: uuid("schedule_id").references(() => scheduledChecksTable.id, { onDelete: "cascade" }).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }).notNull(),
  url: text("url").notNull(),
  httpStatus: integer("http_status"),
  isHealthy: boolean("is_healthy").notNull(),
  issues: text("issues").array().notNull().default([]),
  analysis: text("analysis"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScheduledCheckSchema = createInsertSchema(scheduledChecksTable).omit({
  id: true,
  createdAt: true,
  userId: true,
  lastCheckedAt: true,
  nextCheckAt: true,
});

export const insertCheckResultSchema = createInsertSchema(checkResultsTable).omit({
  id: true,
  checkedAt: true,
});

export type ScheduledCheck = typeof scheduledChecksTable.$inferSelect;
export type CheckResult = typeof checkResultsTable.$inferSelect;
export type InsertScheduledCheck = z.infer<typeof insertScheduledCheckSchema>;
export type InsertCheckResult = z.infer<typeof insertCheckResultSchema>;
