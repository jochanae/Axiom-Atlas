import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const nexusMessagesTable = pgTable("nexus_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  conversationId: text("conversation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNexusMessageSchema = createInsertSchema(nexusMessagesTable).omit({ id: true, createdAt: true });
export type InsertNexusMessage = z.infer<typeof insertNexusMessageSchema>;
export type NexusMessage = typeof nexusMessagesTable.$inferSelect;
