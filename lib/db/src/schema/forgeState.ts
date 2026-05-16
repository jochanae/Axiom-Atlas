import { pgTable, integer, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const projectForgeStateTable = pgTable("project_forge_state", {
  projectId: integer("project_id")
    .notNull()
    .unique()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  forgedAt: timestamp("forged_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProjectForgeState = typeof projectForgeStateTable.$inferSelect;
