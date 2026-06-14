import { pgTable, text, serial, integer, boolean, timestamp, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

export const artifactsTable = pgTable("artifacts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("draft"),
  pinned: boolean("pinned").notNull().default(false),
  parentId: integer("parent_id").references((): AnyPgColumn => artifactsTable.id, { onDelete: "set null" }),
  sources: jsonb("sources"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertArtifactSchema = createInsertSchema(artifactsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertArtifact = z.infer<typeof insertArtifactSchema>;
export type Artifact = typeof artifactsTable.$inferSelect;
