import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const applicationModelsTable = pgTable("application_models", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }).unique(),
  version: integer("version").notNull().default(1),
  identity: jsonb("identity").notNull().default({}),
  intent: jsonb("intent").notNull().default({}),
  pages: jsonb("pages").notNull().default([]),
  components: jsonb("components").notNull().default([]),
  data: jsonb("data").notNull().default({ entities: [], relationships: [] }),
  logic: jsonb("logic").notNull().default([]),
  buildState: jsonb("build_state").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const applicationModelHistoryTable = pgTable("application_model_history", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  modelVersion: integer("model_version").notNull(),
  fieldChanged: text("field_changed").notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  reason: text("reason"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectDnaTable = pgTable("project_dna", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }).unique(),
  creativePrinciples: jsonb("creative_principles").notNull().default([]),
  experienceIntent: jsonb("experience_intent").notNull().default({}),
  visualSketches: jsonb("visual_sketches").notNull().default([]),
  confidence: jsonb("confidence").notNull().default({}),
  status: jsonb("status").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const designPlansTable = pgTable("design_plans", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  body: jsonb("body").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
});

export const projectArtifactsTable = pgTable("project_artifacts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  version: integer("version").notNull().default(1),
  title: text("title").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Zod schemas exported for route validation ─────────────────────────────────

export const ApplicationModelIdentitySchema = z.object({
  name: z.string().optional(),
  purpose: z.string().optional(),
  audience: z.string().optional(),
  category: z.string().optional(),
  coreEmotion: z.string().optional(),
  positioning: z.string().optional(),
  format: z.string().optional(),
  surfaceStrategy: z.string().optional(),
  wedge: z.string().optional(),
  differentiator: z.string().optional(),
}).default({});

export const ApplicationModelIntentSchema = z.object({
  summary: z.string().optional(),
  coreProblems: z.array(z.string()).default([]),
  keyOutcomes: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  confidenceScore: z.number().default(0),
  stack: z.array(z.string()).default([]),
  protectedAreas: z.array(z.string()).default([]),
  approvedAt: z.string().nullable().optional(),
}).default(() => ({ coreProblems: [], keyOutcomes: [], constraints: [], openQuestions: [], confidenceScore: 0, stack: [], protectedAreas: [] }));

export const ApplicationModelBuildStateSchema = z.object({
  generated: z.boolean().default(false),
  generatedAt: z.string().nullable().optional(),
  deployedAt: z.string().nullable().optional(),
  deployUrl: z.string().nullable().optional(),
  generatedFileCount: z.number().default(0),
  stage: z.enum(["Think", "Shape", "Decide", "Workspace", "Strategize", "Build", "Operate", "Evolve"]).default("Think"),
  lastEvolvedAt: z.string().nullable().optional(),
  lastExtractedAt: z.string().nullable().optional(),
}).default(() => ({ generated: false, generatedFileCount: 0, stage: "Think" as const }));

export const ApplicationModelPatchSchema = z.object({
  identity: ApplicationModelIdentitySchema.optional(),
  intent: ApplicationModelIntentSchema.optional(),
  pages: z.array(z.unknown()).optional(),
  components: z.array(z.unknown()).optional(),
  data: z.unknown().optional(),
  logic: z.array(z.unknown()).optional(),
  buildState: ApplicationModelBuildStateSchema.optional(),
  reason: z.string().optional(),
});

export const ApplicationModelSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  version: z.number(),
  identity: ApplicationModelIdentitySchema,
  intent: ApplicationModelIntentSchema,
  pages: z.array(z.unknown()).default([]),
  components: z.array(z.unknown()).default([]),
  data: z.unknown(),
  logic: z.array(z.unknown()).default([]),
  buildState: ApplicationModelBuildStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ApplicationModelHistorySchema = z.object({
  id: z.number(),
  projectId: z.number(),
  modelVersion: z.number(),
  fieldChanged: z.string(),
  previousValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  reason: z.string().nullable(),
  changedAt: z.string(),
});

export const DnaFieldStatusSchema = z.enum(["guessed", "inferred", "confirmed", "committed"]);
export type DnaFieldStatus = z.infer<typeof DnaFieldStatusSchema>;

export const ProjectDnaStatusSchema = z.object({
  creativePrinciples: DnaFieldStatusSchema.optional(),
  emotionalRegister: DnaFieldStatusSchema.optional(),
  interactionPosture: DnaFieldStatusSchema.optional(),
  visualLanguage: DnaFieldStatusSchema.optional(),
  designPrinciples: DnaFieldStatusSchema.optional(),
  visualSketches: DnaFieldStatusSchema.optional(),
}).default({});

export const ProjectDnaConfidenceSchema = z.object({
  creativePrinciples: z.number().min(0).max(100).optional(),
  emotionalRegister: z.number().min(0).max(100).optional(),
  interactionPosture: z.number().min(0).max(100).optional(),
  visualLanguage: z.number().min(0).max(100).optional(),
  designPrinciples: z.number().min(0).max(100).optional(),
}).default({});

export const ProjectDnaPatchSchema = z.object({
  creativePrinciples: z.array(z.string()).optional(),
  experienceIntent: z.unknown().optional(),
  visualSketches: z.array(z.unknown()).optional(),
  confidence: ProjectDnaConfidenceSchema.optional(),
  status: ProjectDnaStatusSchema.optional(),
});

export type ApplicationModel = typeof applicationModelsTable.$inferSelect;
export type ApplicationModelHistory = typeof applicationModelHistoryTable.$inferSelect;
export type ProjectDna = typeof projectDnaTable.$inferSelect;
export type DesignPlan = typeof designPlansTable.$inferSelect;
export type ProjectArtifact = typeof projectArtifactsTable.$inferSelect;
