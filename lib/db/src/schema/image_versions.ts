import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";
import { projectsTable } from "./projects";

export const imageVersionsTable = pgTable("image_versions", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  messageId: integer("message_id"),
  parentVersionId: integer("parent_version_id"),
  prompt: text("prompt").notNull(),
  imageB64: text("image_b64").notNull(),
  imageMimeType: text("image_mime_type").notNull().default("image/png"),
  model: text("model"),
  mode: text("mode"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertImageVersionSchema = createInsertSchema(imageVersionsTable).omit({ id: true, createdAt: true });
export type InsertImageVersion = z.infer<typeof insertImageVersionSchema>;
export type ImageVersionRecord = typeof imageVersionsTable.$inferSelect;
