import { create } from "zustand";

export type NodeType = "SOURCE" | "PROJECT" | "IDEA" | "COMPONENT" | "LEAF";

export type SubComponentType =
  | "SPRINT"
  | "DECISION"
  | "BLOCKER"
  | "OPEN_QUESTION"
  | "OPPORTUNITY"
  | "RISK"
  | "BLUEPRINT"
  | "NEXT_STEP";

export interface MapNode {
  id: string;
  label: string;
  type: NodeType;
  subType?: SubComponentType;
  description?: string;
  status?: "active" | "paused" | "completed" | "backlog";
  position: [number, number, number];
  color?: string;
  children?: MapNode[];
}

export const SUBTYPE_COLORS: Record<SubComponentType, string> = {
  SPRINT: "#C9A24C",
  DECISION: "rgba(74,222,128,0.8)",
  BLOCKER: "rgba(248,113,113,0.8)",
  OPEN_QUESTION: "rgba(200,190,185,0.6)",
  OPPORTUNITY: "#C9A24C",
  RISK: "#D28852",
  BLUEPRINT: "rgba(167,139,250,0.8)",
  NEXT_STEP: "rgba(45,212,191,0.8)",
};

export const LAYER_ZOOM = { 1: 25, 2: 8, 3: 3 } as const;

export interface FocusedContext {
  projectId?: number;
  projectName?: string;
  parentId?: string;
  parentLabel?: string;
}

interface MapStore {
  currentLayer: 1 | 2 | 3;
  focusedNodeId: string | null;
  cameraTarget: [number, number, number];
  zoomLevel: number;
  context: FocusedContext;
  navigateToNode: (
    id: string,
    position: [number, number, number],
    layer: 1 | 2 | 3,
    context?: FocusedContext,
  ) => void;
  resetToSource: () => void;
}

export const useMapStore = create<MapStore>((set) => ({
  currentLayer: 1,
  focusedNodeId: null,
  cameraTarget: [0, 0, 0],
  zoomLevel: LAYER_ZOOM[1],
  context: {},
  navigateToNode: (id, position, layer, context) =>
    set((s) => ({
      currentLayer: layer,
      focusedNodeId: id,
      cameraTarget: position,
      zoomLevel: LAYER_ZOOM[layer],
      context: { ...s.context, ...(context ?? {}) },
    })),
  resetToSource: () =>
    set({
      currentLayer: 1,
      focusedNodeId: null,
      cameraTarget: [0, 0, 0],
      zoomLevel: LAYER_ZOOM[1],
      context: {},
    }),
}));
