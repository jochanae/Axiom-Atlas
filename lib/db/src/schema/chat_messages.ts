import { pgTable, text, serial, integer, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  intentType: text("intent_type"),
  catchPayload: jsonb("catch_payload"),
  executionTimeMs: integer("execution_time_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 5 }),
  runStatus: text("run_status"),
  runSummary: text("run_summary"),
  runActions: jsonb("run_actions"),
  runArtifacts: jsonb("run_artifacts"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
