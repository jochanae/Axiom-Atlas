import { pgTable, text, serial, integer, boolean, timestamp, numeric, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { sessionsTable } from "./sessions";

export const entriesTable = pgTable("entries", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("committed"),
  title: text("title").notNull(),
  summary: text("summary"),
  details: text("details"),
  severity: text("severity").notNull().default("committed"),
  verb: text("verb"),
  buildId: text("build_id"),
  touched: text("touched").array(),
  isViolation: boolean("is_violation").notNull().default(false),
  costOfLesson: numeric("cost_of_lesson"),
  deviation: boolean("deviation").notNull().default(false),
  deviationReason: text("deviation_reason"),
  catchAgainstId: integer("catch_against_id"),
  supersedesId: integer("supersedes_id").references((): AnyPgColumn => entriesTable.id, { onDelete: "set null" }),
  cardSchemaVersion: integer("card_schema_version").default(1),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  mode: text("mode"),
  sourceMessageId: integer("source_message_id"),
  contextWhat: text("context_what"),
  contextWhy: text("context_why"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEntrySchema = createInsertSchema(entriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type Entry = typeof entriesTable.$inferSelect;
