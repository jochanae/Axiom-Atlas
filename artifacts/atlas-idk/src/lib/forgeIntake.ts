// Forge intake helper — single entry point for "brain dump → /api/forge".
// Both TheForge and the Axiom Flow composer call this so the two surfaces
// never drift in payload shape or response contract.
//
// Contract mirrors TheForge.handleForge exactly:
//   body:     { transcript, projectId, projectContext?, repoContext? }
//   response: { nodes: ArchNode[], summary: string }

import type { ArchNode } from "@/components/AxiomFlow";

export type ForgeIntakeInput = {
  transcript: string;
  projectId?: number | null;
  projectContext?: string | null;
  repoContext?: string | null;
  signal?: AbortSignal;
};

export type ForgeIntakeResult = {
  nodes: ArchNode[];
  summary: string;
};

export async function submitForgeIntake(input: ForgeIntakeInput): Promise<ForgeIntakeResult> {
  const transcript = input.transcript.trim();
  if (!transcript) throw new Error("Empty transcript");

  const body: Record<string, unknown> = { transcript, projectId: input.projectId ?? undefined };
  if (input.projectContext && input.projectContext.trim()) body.projectContext = input.projectContext.trim();
  if (input.repoContext) body.repoContext = input.repoContext;

  const res = await fetch("/api/forge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal: input.signal,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Forge intake failed");
  }
  return (await res.json()) as ForgeIntakeResult;
}
