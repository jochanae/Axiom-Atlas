import { pgTable, serial, integer, text, 
  jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { sessionsTable } from "./sessions";

export const artifactsTable = pgTable("artifacts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull()
    .references(() => usersTable.id, 
      { onDelete: "cascade" }),
  projectId: integer("project_id")
    .references(() => projectsTable.id, 
      { onDelete: "cascade" }),
  sessionId: integer("session_id")
    .references(() => sessionsTable.id, 
      { onDelete: "set null" }),
  type: text("type").notNull().default("document"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("draft"),
  sources: jsonb("sources"),
  createdAt: timestamp("created_at")
    .notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull().defaultNow(),
});
