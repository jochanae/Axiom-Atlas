import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const GENOME_STAGES = [
  "Think",
  "Shape",
  "Decide",
  "Workspace",
  "Strategize",
  "Build",
  "Operate",
  "Evolve",
] as const;

export type GenomeStage = typeof GENOME_STAGES[number];

export const projectGenomeTable = pgTable("project_genome", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  purpose: text("purpose"),
  coreEmotion: text("core_emotion"),
  audience: text("audience"),
  identity: text("identity"),
  constraints: text("constraints").array().notNull().default([]),
  openQuestions: text("open_questions").array().notNull().default([]),
  stage: text("stage").notNull().default("Think"),
  confidenceScore: integer("confidence_score").notNull().default(0),
  lastEvolvedAt: timestamp("last_evolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectGenomeSchema = createInsertSchema(projectGenomeTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProjectGenome = z.infer<typeof insertProjectGenomeSchema>;
export type ProjectGenome = typeof projectGenomeTable.$inferSelect;
