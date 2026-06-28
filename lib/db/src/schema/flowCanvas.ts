import { pgTable, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const projectFlowCanvasTable = pgTable("project_flow_canvas", {
  projectId: integer("project_id")
    .notNull()
    .unique()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  nodes: jsonb("nodes").notNull().default([]),
  edges: jsonb("edges").notNull().default([]),
  drillCache: jsonb("drill_cache"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ProjectFlowCanvas = typeof projectFlowCanvasTable.$inferSelect;
