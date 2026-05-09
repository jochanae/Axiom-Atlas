import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const readinessSnapshotsTable = pgTable("readiness_snapshots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReadinessSnapshotSchema = createInsertSchema(readinessSnapshotsTable).omit({ id: true, recordedAt: true });
export type InsertReadinessSnapshot = z.infer<typeof insertReadinessSnapshotSchema>;
export type ReadinessSnapshot = typeof readinessSnapshotsTable.$inferSelect;
