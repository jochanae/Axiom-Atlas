import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const adminNotesTable = pgTable("admin_notes", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const errorLogsTable = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  message: text("message").notNull(),
  stack: text("stack"),
  url: text("url"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  context: text("context"),
  resolved: boolean("resolved").notNull().default(false),
  adminResponse: text("admin_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminNote = typeof adminNotesTable.$inferSelect;
export type ErrorLog = typeof errorLogsTable.$inferSelect;
