import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const thoughtsTable = pgTable("thoughts", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertThoughtSchema = createInsertSchema(thoughtsTable).omit({ id: true, createdAt: true });
export type InsertThought = z.infer<typeof insertThoughtSchema>;
export type Thought = typeof thoughtsTable.$inferSelect;
