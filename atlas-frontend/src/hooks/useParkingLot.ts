import { useState, useCallback } from "react";
import { getListEntriesQueryKey, getListSessionsQueryKey } from "@workspace/api-client-react";
import type { QueryClient } from "@tanstack/react-query";

type ProjectStateLike = {
  refresh: () => Promise<unknown> | unknown;
};

type Options = {
  projectState: ProjectStateLike;
  queryClient: QueryClient;
  useProjectStateFallback: boolean;
  getListEntriesQueryKey: (projectId: number | string, params: Record<string, unknown>) => readonly unknown[];
  getListSessionsQueryKey: (projectId: number | string) => readonly unknown[];
};

export function useParkingLot(
  projectId: number | string | undefined,
  opts: Options,
) {
  const { projectState, queryClient, useProjectStateFallback, getListEntriesQueryKey, getListSessionsQueryKey } = opts;
  const [showParkingDrawer, setShowParkingDrawer] = useState(false);

  const refreshParkedEntries = useCallback(async () => {
    if (!projectId) return;
    await projectState.refresh();
    if (useProjectStateFallback) {
      queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId, {}) });
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey(projectId) });
    }
  }, [projectId, projectState, queryClient, useProjectStateFallback, getListEntriesQueryKey, getListSessionsQueryKey]);

  return {
    showParkingDrawer,
    setShowParkingDrawer,
    refreshParkedEntries,
  };
}
