import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, entriesTable, projectsTable } from "@workspace/db";

const router: IRouter = Router();

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const NEGATION_WORDS = new Set(["no", "not", "never", "disable", "disabled", "remove", "removed", "avoid"]);

const OPPOSITE_SIGNAL_PAIRS: Array<[string, string]> = [
  ["enable", "disable"],
  ["enabled", "disabled"],
  ["add", "remove"],
  ["added", "removed"],
  ["use", "avoid"],
  ["include", "exclude"],
  ["increase", "decrease"],
  ["more", "less"],
  ["first", "last"],
  ["mobile", "desktop"],
  ["strict", "loose"],
  ["sync", "async"],
  ["public", "private"],
  ["required", "optional"],
];

export type ProjectSummary = {
  id: number;
  name: string;
};

export type CommittedEntry = {
  id: number;
  projectId: number;
  title: string;
};

export type Tension = {
  projectA: ProjectSummary;
  projectB: ProjectSummary;
  entryA: { id: number; title: string };
  entryB: { id: number; title: string };
  score: number;
};

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function uniqueWords(text: string): Set<string> {
  return new Set(normalizeWords(text));
}

function sharedWords(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((word) => b.has(word));
}

function hasNegation(words: Set<string>): boolean {
  return [...NEGATION_WORDS].some((word) => words.has(word));
}

function hasOppositeSignal(wordsA: Set<string>, wordsB: Set<string>): boolean {
  return OPPOSITE_SIGNAL_PAIRS.some(([left, right]) => (
    (wordsA.has(left) && wordsB.has(right)) || (wordsA.has(right) && wordsB.has(left))
  ));
}

function tensionScore(sharedCount: number, maxWordCount: number, hasNegationSignal: boolean, hasOppositeDirection: boolean): number {
  const overlapScore = maxWordCount > 0 ? sharedCount / maxWordCount : 0;
  const signalBoost = hasOppositeDirection ? 0.45 : 0.3;
  const negationBoost = hasNegationSignal ? 0.1 : 0;
  return Math.min(0.95, Number((overlapScore + signalBoost + negationBoost).toFixed(2)));
}

function detectTension(
  entryA: CommittedEntry,
  entryB: CommittedEntry,
  projectById: Map<number, ProjectSummary>,
): Tension | null {
  const wordsA = uniqueWords(entryA.title);
  const wordsB = uniqueWords(entryB.title);
  const shared = sharedWords(wordsA, wordsB);
  if (shared.length < 2) return null;

  const negationSignal = hasNegation(wordsA) || hasNegation(wordsB);
  const oppositeDirection = hasOppositeSignal(wordsA, wordsB);
  if (!negationSignal && !oppositeDirection) return null;

  const projectA = projectById.get(entryA.projectId);
  const projectB = projectById.get(entryB.projectId);
  if (!projectA || !projectB) return null;

  return {
    projectA,
    projectB,
    entryA: { id: entryA.id, title: entryA.title },
    entryB: { id: entryB.id, title: entryB.title },
    score: tensionScore(shared.length, Math.max(wordsA.size, wordsB.size), negationSignal, oppositeDirection),
  };
}

export function findSemanticTensions(projects: ProjectSummary[], entries: CommittedEntry[]): Tension[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const tensions: Tension[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const entryA = entries[i];
      const entryB = entries[j];
      if (entryA.projectId === entryB.projectId) continue;

      const tension = detectTension(entryA, entryB, projectById);
      if (tension) tensions.push(tension);
    }
  }

  return tensions.sort((a, b) => b.score - a.score);
}

export function findSemanticTensionsForProject(
  projectId: number,
  projects: ProjectSummary[],
  entries: CommittedEntry[],
): Tension[] {
  return findSemanticTensions(projects, entries).filter((tension) => (
    tension.projectA.id === projectId || tension.projectB.id === projectId
  ));
}

// GET /api/projects/tensions — compare committed decisions across projects.
router.get("/projects/tensions", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId));

    if (projects.length < 2) {
      res.json({ tensions: [] });
      return;
    }

    const projectIds = projects.map((project) => project.id);
    const entries = await db
      .select({ id: entriesTable.id, projectId: entriesTable.projectId, title: entriesTable.title })
      .from(entriesTable)
      .where(and(inArray(entriesTable.projectId, projectIds), eq(entriesTable.status, "committed")));

    const tensions = findSemanticTensions(projects, entries);
    res.json({ tensions });
  } catch (err) {
    req.log?.error({ err }, "projects/tensions error");
    res.status(500).json({ error: "Failed to detect project tensions" });
  }
});

export default router;
