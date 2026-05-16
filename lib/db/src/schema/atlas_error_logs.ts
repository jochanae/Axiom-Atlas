import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const atlasErrorLogsTable = pgTable("atlas_error_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  errorMessage: text("error_message").notNull(),
  stackTrace: text("stack_trace"),
  route: text("route").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  projectId: text("project_id").notNull(),
});

export const insertAtlasErrorLogSchema = createInsertSchema(atlasErrorLogsTable).omit({ id: true, createdAt: true });
export type InsertAtlasErrorLog = z.infer<typeof insertAtlasErrorLogSchema>;
export type AtlasErrorLog = typeof atlasErrorLogsTable.$inferSelect;
