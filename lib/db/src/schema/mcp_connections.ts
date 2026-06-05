import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type McpTool = { name: string; description?: string | null };

export const mcpConnectionsTable = pgTable("mcp_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  token: text("token"),
  tools: jsonb("tools").$type<McpTool[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type McpConnection = typeof mcpConnectionsTable.$inferSelect;
