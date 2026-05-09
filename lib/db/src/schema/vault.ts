import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const vaultTable = pgTable("vault", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  projectName: text("project_name").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  entryCount: integer("entry_count").notNull().default(0),
  tags: text("tags").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVaultSchema = createInsertSchema(vaultTable).omit({ id: true, createdAt: true });
export type InsertVault = z.infer<typeof insertVaultSchema>;
export type VaultSave = typeof vaultTable.$inferSelect;
