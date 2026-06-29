import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const projectZipImportsTable = pgTable("project_zip_imports", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileCount: integer("file_count").notNull().default(0),
  fileTree: jsonb("file_tree").notNull().default([]),
  fullContext: text("full_context"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProjectZipImportSchema = z.object({
  projectId: z.number(),
  fileName: z.string(),
  fileCount: z.number().default(0),
  fileTree: z.array(z.unknown()).default([]),
  fullContext: z.string().nullable().optional(),
});

export type ProjectZipImport = typeof projectZipImportsTable.$inferSelect;
