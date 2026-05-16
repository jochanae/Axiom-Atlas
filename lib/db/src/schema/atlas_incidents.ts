import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const atlasIncidentsTable = pgTable("atlas_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  projectId: text("project_id").notNull(),
  filesChanged: text("files_changed").array().notNull(),
  commitMessage: text("commit_message").notNull(),
  branchName: text("branch_name").notNull(),
  prUrl: text("pr_url").notNull(),
  outcome: text("outcome"),
  notes: text("notes"),
});

export const insertAtlasIncidentSchema = createInsertSchema(atlasIncidentsTable).omit({ id: true, createdAt: true });
export type InsertAtlasIncident = z.infer<typeof insertAtlasIncidentSchema>;
export type AtlasIncident = typeof atlasIncidentsTable.$inferSelect;
