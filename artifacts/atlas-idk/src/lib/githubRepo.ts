type LinkedRepoRecord = {
  fullName?: unknown;
  defaultBranch?: unknown;
  name?: unknown;
};

export interface ParsedLinkedRepo {
  fullName: string;
  defaultBranch: string;
  name: string;
}

function buildParsedRepo(fullName: string, defaultBranch?: string | null, name?: string | null): ParsedLinkedRepo | null {
  const normalizedFullName = fullName.trim();
  if (!normalizedFullName) return null;

  return {
    fullName: normalizedFullName,
    defaultBranch: defaultBranch?.trim() || "main",
    name: name?.trim() || normalizedFullName.split("/")[1] || normalizedFullName,
  };
}

export function parseLinkedRepo(linkedRepo?: string | null): ParsedLinkedRepo | null {
  if (!linkedRepo) return null;

  const trimmed = linkedRepo.trim();
  if (!trimmed) return null;

  let parsed: unknown = trimmed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return buildParsedRepo(trimmed);
  }

  if (typeof parsed === "string") {
    return buildParsedRepo(parsed);
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const repo = parsed as LinkedRepoRecord;
  if (typeof repo.fullName !== "string") return null;

  return buildParsedRepo(
    repo.fullName,
    typeof repo.defaultBranch === "string" ? repo.defaultBranch : null,
    typeof repo.name === "string" ? repo.name : null,
  );
}

export function getLinkedRepoFullName(linkedRepo?: string | null): string | null {
  return parseLinkedRepo(linkedRepo)?.fullName ?? null;
}

export function normalizeGitHubRepoInput(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }

  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function serializeLinkedRepo(repo: {
  fullName: string;
  defaultBranch?: string | null;
  name?: string | null;
}): string {
  return JSON.stringify({
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch?.trim() || "main",
    name: repo.name?.trim() || repo.fullName.split("/")[1] || repo.fullName,
  });
}