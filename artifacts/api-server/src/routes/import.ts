import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, projectsTable, entriesTable } from "@workspace/db";

const router: IRouter = Router();

const ImportDecisionSchema = z.object({
  tier: z.number().int().min(1).max(3),
  text: z.string().min(1),
});

const ImportBodySchema = z.object({
  project_name: z.string().min(1),
  builder: z.string().optional(),
  nodes_resolved: z.array(z.string()).optional(),
  manifest: z.string().optional(),
  decisions: z.array(ImportDecisionSchema).optional(),
});

function tierToCategory(tier: number): string {
  if (tier === 1) return "STRUCTURE";
  if (tier === 2) return "LOGIC";
  return "GENERAL";
}

router.post("/import", async (req, res): Promise<void> => {
  const parsed = ImportBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { project_name, builder, nodes_resolved, manifest, decisions } = parsed.data;

  const today = new Date().toISOString().slice(0, 10);

  let memory: string | null = null;
  if (manifest) {
    const header = [
      `[axiom_handoff] [${today}] Technical Manifest`,
      builder ? `Builder: ${builder}` : null,
      nodes_resolved?.length ? `Nodes resolved: ${nodes_resolved.join(", ")}` : null,
    ].filter(Boolean).join(" | ");

    memory = `${header}\n\n${manifest}`;
  }

  const [project] = await db
    .insert(projectsTable)
    .values({
      name: project_name,
      description: [
        builder ? `Builder: ${builder}` : null,
        nodes_resolved?.length ? `Nodes: ${nodes_resolved.join(", ")}` : null,
      ].filter(Boolean).join(" | ") || null,
      memory,
    })
    .returning();

  if (decisions?.length) {
    await db.insert(entriesTable).values(
      decisions.map((d) => ({
        projectId: project.id,
        title: d.text,
        status: "committed" as const,
        severity: "committed" as const,
        mode: tierToCategory(d.tier),
        verb: "axiom_import",
      }))
    );
  }

  res.status(201).json({ projectId: project.id });
});

export default router;
