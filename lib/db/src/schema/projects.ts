import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("shaping"),
  entityType: text("entity_type").notNull().default("project"),
  memory: text("memory"),
  previewUrl: text("preview_url"),
  githubToken: text("github_token"),
  linkedRepo: text("linked_repo"),
  nodeState: jsonb("node_state").default({}),
  pushHistory: jsonb("push_history").default([]),
  shape: jsonb("shape").notNull().default({ identity: [], constraints: [], formats: [] }),
  lastHandoverAt: timestamp("last_handover_at", { withTimezone: true }),
  lastHandoverHash: text("last_handover_hash"),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true, userId: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
