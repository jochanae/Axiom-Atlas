import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

export const nexusMessagesTable = pgTable("nexus_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "set null" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  conversationId: text("conversation_id"),
  messageType: text("message_type").default("message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNexusMessageSchema = createInsertSchema(nexusMessagesTable).omit({ id: true, createdAt: true });
export type InsertNexusMessage = z.infer<typeof insertNexusMessageSchema>;
export type NexusMessage = typeof nexusMessagesTable.$inferSelect;
