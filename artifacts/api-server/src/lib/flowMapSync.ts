/**
 * Flow Map sync lib — shared between the applicationModel route and the
 * applicationModelExtraction lib so neither has a lib→route dependency.
 */
import { db, applicationModelsTable, projectFlowCanvasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

type CanvasNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
};
type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
  data?: Record<string, unknown>;
};

/**
 * Merge-syncs the Flow Map canvas from the Application Model.
 *
 * Semantics:
 *  - AM-origin nodes (data.source === "application-model") are added, updated,
 *    or removed to match the current AM pages + data.entities.
 *  - Existing position is preserved for any AM node that was already placed.
 *  - User-created nodes and edges (no source tag) are never touched.
 *  - AM-derived edges are rebuilt from data.relationships; user edges are kept.
 */
export async function syncFlowCanvasFromModel(projectId: number): Promise<{
  nodeCount: number;
  edgeCount: number;
  added: number;
  removed: number;
  updated: number;
}> {
  const ZERO = { nodeCount: 0, edgeCount: 0, added: 0, removed: 0, updated: 0 };

  const [model] = await db
    .select()
    .from(applicationModelsTable)
    .where(eq(applicationModelsTable.projectId, projectId))
    .limit(1);

  if (!model) return ZERO;

  const pages = (model.pages as Array<{ id: string; name: string; route?: string; description?: string }>) ?? [];
  const dataSection = (model.data as {
    entities?: Array<{ id: string; name: string; description?: string }>;
    relationships?: Array<{ id: string; from: string; to: string; type: string; label?: string }>;
  }) ?? {};
  const entities = dataSection.entities ?? [];
  const relationships = dataSection.relationships ?? [];

  if (pages.length === 0 && entities.length === 0) return ZERO;

  const [existingCanvas] = await db
    .select({ nodes: projectFlowCanvasTable.nodes, edges: projectFlowCanvasTable.edges })
    .from(projectFlowCanvasTable)
    .where(eq(projectFlowCanvasTable.projectId, projectId))
    .limit(1);

  const existingNodes = (existingCanvas?.nodes as CanvasNode[]) ?? [];
  const existingEdges = (existingCanvas?.edges as CanvasEdge[]) ?? [];

  const existingAmNodes = existingNodes.filter((n) => n.data?.source === "application-model");
  const userNodes = existingNodes.filter((n) => n.data?.source !== "application-model");
  const existingAmNodeMap = new Map(existingAmNodes.map((n) => [n.id, n]));

  const existingAmEdgeIds = new Set(
    existingEdges.filter((e) => e.data?.source === "application-model").map((e) => e.id),
  );
  const userEdges = existingEdges.filter((e) => !existingAmEdgeIds.has(e.id));

  const COL_SPACING = 280;
  const ROW_SPACING = 180;
  const desiredAmNodes: CanvasNode[] = [];

  pages.forEach((page, i) => {
    const id = `am-page-${page.id}`;
    const prior = existingAmNodeMap.get(id);
    desiredAmNodes.push({
      id,
      type: "default",
      position: prior?.position ?? { x: 100, y: 100 + i * ROW_SPACING },
      data: {
        label: page.name,
        route: page.route ?? null,
        description: page.description ?? null,
        nodeKind: "page",
        source: "application-model",
      },
      style: { background: "#EFF6FF", border: "1.5px solid #3B82F6", borderRadius: 8 },
    });
  });

  entities.forEach((entity, i) => {
    const id = `am-entity-${entity.id}`;
    const prior = existingAmNodeMap.get(id);
    desiredAmNodes.push({
      id,
      type: "default",
      position: prior?.position ?? { x: 100 + COL_SPACING, y: 100 + i * ROW_SPACING },
      data: {
        label: entity.name,
        description: entity.description ?? null,
        nodeKind: "entity",
        source: "application-model",
      },
      style: { background: "#F0FDF4", border: "1.5px solid #22C55E", borderRadius: 8 },
    });
  });

  const desiredAmNodeIds = new Set(desiredAmNodes.map((n) => n.id));
  const added = desiredAmNodes.filter((n) => !existingAmNodeMap.has(n.id)).length;
  const removed = existingAmNodes.filter((n) => !desiredAmNodeIds.has(n.id)).length;
  const updated = desiredAmNodes.filter((n) => existingAmNodeMap.has(n.id)).length;

  const amEdges: CanvasEdge[] = relationships.map((rel) => ({
    id: `am-rel-${rel.id}`,
    source: `am-page-${rel.from}`,
    target: `am-entity-${rel.to}`,
    label: rel.label ?? rel.type,
    type: "smoothstep",
    data: { source: "application-model" },
  }));

  const finalNodes: CanvasNode[] = [...desiredAmNodes, ...userNodes];
  const finalEdges: CanvasEdge[] = [...amEdges, ...userEdges];

  await db
    .insert(projectFlowCanvasTable)
    .values({ projectId, nodes: finalNodes as unknown[], edges: finalEdges as unknown[] })
    .onConflictDoUpdate({
      target: projectFlowCanvasTable.projectId,
      set: { nodes: finalNodes as unknown[], edges: finalEdges as unknown[], updatedAt: new Date() },
    });

  if (added > 0 || removed > 0) {
    logger.info({ projectId, added, removed, updated }, "flowMapSync: canvas updated from AM");
  }

  return { nodeCount: finalNodes.length, edgeCount: finalEdges.length, added, removed, updated };
}
