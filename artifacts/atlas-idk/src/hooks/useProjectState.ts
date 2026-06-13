import { useCallback, useEffect, useState } from "react";
import { Project, Session, Entry } from "@workspace/api-client-react";
import { useShellStore } from "@/store/shellStore";

export type ProjectForgeState = {
  forged?: boolean;
  dismissed?: boolean;
  [key: string]: unknown;
} | null;

export type ProjectStatePayload = {
  project: Project | null;
  activeSession: Session | null;
  decisions: Entry[];
  parked: Entry[];
  parkedCount: number;
  forgeState: ProjectForgeState;
  memorySummary: string | null;
  recentContext: unknown;
};

const EMPTY_PROJECT_STATE: ProjectStatePayload = {
  project: null,
  activeSession: null,
  decisions: [],
  parked: [],
  parkedCount: 0,
  forgeState: null,
  memorySummary: null,
  recentContext: null,
};

const ACTIVE_PROJECT_STORAGE_KEY = "atlas-active-project-id";

function clearStoredActiveProject() {
  useShellStore.getState().setProjectId(null);
  try {
    localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  } catch {
    // Storage access can fail in restricted browser contexts.
  }
}

export function useProjectState(projectId: number | null) {
  const [state, setState] = useState<ProjectStatePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadProjectState = useCallback(
    async (signal?: AbortSignal) => {
      if (projectId == null) {
        setState(null);
        setLoading(false);
        setError(null);
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/projects/${projectId}/state`, {
          credentials: "include",
          signal,
        });
        if (res.status === 404) clearStoredActiveProject();
        if (!res.ok) throw new Error(`Project state failed: HTTP ${res.status}`);
        const payload = (await res.json()) as Partial<ProjectStatePayload>;
        const nextState: ProjectStatePayload = {
          ...EMPTY_PROJECT_STATE,
          ...payload,
          project: payload.project ?? null,
          activeSession: payload.activeSession ?? null,
          decisions: Array.isArray(payload.decisions) ? payload.decisions : [],
          parked: Array.isArray(payload.parked) ? payload.parked : [],
          parkedCount:
            typeof payload.parkedCount === "number"
              ? payload.parkedCount
              : Array.isArray(payload.parked)
                ? payload.parked.length
                : 0,
          forgeState: payload.forgeState ?? null,
          memorySummary: payload.memorySummary ?? null,
          recentContext: payload.recentContext ?? null,
        };
        if (!nextState.project) clearStoredActiveProject();
        setState(nextState);
        return nextState;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return null;
        const nextError = err instanceof Error ? err : new Error("Project state failed");
        setError(nextError);
        return null;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (projectId == null) {
      setState(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    void loadProjectState(controller.signal);
    const interval = window.setInterval(() => {
      void loadProjectState();
    }, 30_000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadProjectState, projectId]);

  return {
    state,
    project: state?.project ?? null,
    activeSession: state?.activeSession ?? null,
    decisions: state?.decisions ?? [],
    parked: state?.parked ?? [],
    parkedCount: state?.parkedCount ?? 0,
    forgeState: state?.forgeState ?? null,
    memorySummary: state?.memorySummary ?? null,
    recentContext: state?.recentContext ?? null,
    loading,
    error,
    refresh: loadProjectState,
  };
}
