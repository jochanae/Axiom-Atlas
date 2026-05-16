export type PlanStepType = "analysis" | "edit" | "push" | "read" | "other";

export type PlanConfidence = "high" | "medium" | "low";

export type Plan = {
  title: string;
  steps: Array<{
    order: number;
    description: string;
    type: PlanStepType;
    file?: string;
  }>;
  confidence: PlanConfidence;
  estimatedChanges: number;
  reversible: boolean;
};

export type PlanStepStatus = "pending" | "completed" | "current" | "failed";

export type PlanExecution = {
  currentStepOrder?: number;
  completedStepOrders?: number[];
  failedStep?: { order: number; error: string };
  changedFiles?: number;
  statusMessage?: string;
};

const PLAN_PHRASE_RE = /\b(here'?s the plan|here'?s what i(?:'ll| will) do|plan:|steps:|i(?:'ll| will):)\b/i;
const NUMBERED_STEP_RE = /^\s*(\d+)[.)]\s+(.+)$/;
const BULLET_RE = /^\s*[-*•]\s+(.+)$/;
const ACTION_RE = /\b(add|apply|build|change|check|commit|create|edit|fetch|fix|implement|inspect|move|patch|push|read|refactor|remove|review|run|scan|test|update|wire)\b/i;
const PATH_RE = /(?:[\w.-]+\/)+(?:[\w.-]+\.\w+)|\b[\w.-]+\.(?:tsx?|jsx?|css|scss|json|mdx?|html|py|go|rs|sql|yml|yaml)\b/;

function stripPlanNoise(content: string): string {
  return content
    .replace(/FILE_EDIT_START[\s\S]*?FILE_EDIT_END/g, "")
    .replace(/LINE_PATCH_START[\s\S]*?LINE_PATCH_END/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

function cleanDescription(value: string): string {
  return value
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;]\s*$/, "");
}

function extractFile(value: string): string | undefined {
  return value.match(PATH_RE)?.[0];
}

function classifyStep(value: string): PlanStepType {
  if (/\b(push|commit|pull request|pr|github)\b/i.test(value)) return "push";
  if (/\b(edit|change|update|patch|write|implement|create|remove|refactor|fix)\b/i.test(value)) return "edit";
  if (/\b(read|inspect|scan|review|look at|fetch)\b/i.test(value)) return "read";
  if (/\b(analy[sz]e|compare|decide|map|plan|identify|confirm|check)\b/i.test(value)) return "analysis";
  return "other";
}

function titleFromContent(content: string, steps: Array<{ description: string }>): string {
  const heading = content.split("\n").find((line) => /^#{1,3}\s+\S/.test(line.trim()));
  if (heading) return cleanDescription(heading).slice(0, 110);

  const phraseLine = content.split("\n").find((line) => PLAN_PHRASE_RE.test(line));
  if (phraseLine) {
    const afterColon = phraseLine.includes(":") ? phraseLine.split(":").slice(1).join(":").trim() : "";
    const cleaned = cleanDescription(afterColon || phraseLine);
    if (cleaned.length > 12 && !PLAN_PHRASE_RE.test(cleaned)) return cleaned.slice(0, 110);
  }

  const firstSentence = content
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .find((part) => cleanDescription(part).length > 12);
  if (firstSentence) return cleanDescription(firstSentence).slice(0, 110);

  return steps[0]?.description.slice(0, 110) || "Proposed plan";
}

function renumberSteps(rawSteps: string[]) {
  return rawSteps
    .map(cleanDescription)
    .filter((description) => description.length > 0)
    .slice(0, 12)
    .map((description, index) => {
      const file = extractFile(description);
      return {
        order: index + 1,
        description,
        type: classifyStep(description),
        ...(file ? { file } : {}),
      };
    });
}

export function detectPlanFromText(
  content: string,
  options: {
    confidence?: PlanConfidence;
    filePaths?: string[];
    allowConversational?: boolean;
  } = {},
): Plan | null {
  const text = stripPlanNoise(content);
  if (!text) return null;

  const lines = text.split("\n");
  const numbered = lines
    .map((line) => line.match(NUMBERED_STEP_RE)?.[2])
    .filter((value): value is string => !!value && ACTION_RE.test(value));

  const explicit = PLAN_PHRASE_RE.test(text);
  const hasNumberedPlan = numbered.length >= 3;

  const sectionSteps: string[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index].trim();
    const isHeader = /^#{1,3}\s+\S/.test(line) || /^[A-Z][\w\s/-]{2,}:$/.test(line);
    if (!isHeader) continue;
    const following = lines.slice(index + 1, index + 7);
    const items = following
      .map((candidate) => candidate.match(BULLET_RE)?.[1] ?? candidate.match(NUMBERED_STEP_RE)?.[2])
      .filter((value): value is string => !!value && ACTION_RE.test(value));
    if (items.length >= 2) sectionSteps.push(...items);
  }

  const rawSteps = hasNumberedPlan ? numbered : sectionSteps;
  const structuredAfterPhrase = explicit && rawSteps.length >= 2;
  if (!options.allowConversational && !hasNumberedPlan && !structuredAfterPhrase && sectionSteps.length < 2) {
    return null;
  }

  const steps = renumberSteps(rawSteps.length > 0 ? rawSteps : numbered);
  if (steps.length < 2) return null;

  const touched = new Set<string>(options.filePaths ?? []);
  for (const step of steps) {
    if (step.file) touched.add(step.file);
  }

  return {
    title: titleFromContent(text, steps),
    steps,
    confidence: options.confidence ?? "medium",
    estimatedChanges: touched.size,
    reversible: touched.size > 0,
  };
}
