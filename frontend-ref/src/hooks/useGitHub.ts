import { useState, useEffect, useCallback } from "react";

export type GitHubConnectionStatus = "connected" | "read-only" | "not-connected";

export type NormalizedGitHubStatus = {
  canRead: boolean;
  canWrite: boolean;
  hasServerToken: boolean;
  status: GitHubConnectionStatus;
  label: string;
  tokenHeader: string | null;
};

type GitHubState = {
  isConnected: boolean;
  canRead: boolean;
  canWrite: boolean;
  hasServerToken: boolean;
  status: GitHubConnectionStatus;
  statusLabel: string;
  tokenHeader: string | null;
  isLoading: boolean;
  error: string | null;
  connect: (token: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
};

const NOT_CONNECTED_STATUS: NormalizedGitHubStatus = {
  canRead: false,
  canWrite: false,
  hasServerToken: false,
  status: "not-connected",
  label: "Not connected",
  tokenHeader: null,
};

type GitHubStatusResponse = {
  canRead?: boolean | null;
  canWrite?: boolean | null;
  hasServerToken?: boolean | null;
};

type GitHubTokenResponse = {
  connected?: boolean;
  username?: string;
  error?: string;
};

function githubStatusUrl(projectId?: number | null): string {
  if (projectId == null) return "/api/github/status";
  return `/api/github/status?projectId=${encodeURIComponent(String(projectId))}`;
}

function normalizeGitHubStatus(data: GitHubStatusResponse): NormalizedGitHubStatus {
  const canRead = !!data.canRead;
  const canWrite = !!data.canWrite;
  const hasServerToken = !!data.hasServerToken;
  const status: GitHubConnectionStatus = canWrite
    ? "connected"
    : canRead && hasServerToken
      ? "read-only"
      : "not-connected";

  return {
    canRead,
    canWrite,
    hasServerToken,
    status,
    label: status === "connected"
      ? "GitHub connected"
      : status === "read-only"
        ? "Read-only (no personal token)"
        : "Not connected",
    tokenHeader: canWrite ? "__account__" : canRead && hasServerToken ? "__server__" : null,
  };
}

export async function fetchGitHubStatus(projectId?: number | null): Promise<NormalizedGitHubStatus> {
  const res = await fetch(githubStatusUrl(projectId), {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as GitHubStatusResponse;
  return normalizeGitHubStatus(data);
}

export function useGitHub(projectId?: number | null): GitHubState {
  const [githubStatus, setGithubStatus] = useState<NormalizedGitHubStatus>(NOT_CONNECTED_STATUS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setIsLoading(true);
    try {
      const status = await fetchGitHubStatus(projectId);
      setGithubStatus(status);
      setError(null);
    } catch {
      setGithubStatus(NOT_CONNECTED_STATUS);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void check(); }, [check]);

  const connect = useCallback(async (token: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch("/api/github/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json().catch(() => ({})) as GitHubTokenResponse;
      if (!res.ok) {
        setError(res.status === 422 ? data.error ?? "Failed to save token" : "Failed to save token");
        return false;
      }
      if (!data.connected) {
        setError("Failed to save token");
        return false;
      }
      setGithubStatus({
        canRead: true,
        canWrite: true,
        hasServerToken: true,
        status: "connected",
        label: data.username ? `GitHub connected (${data.username})` : "GitHub connected",
        tokenHeader: "__account__",
      });
      return true;
    } catch {
      setError("Failed to save token");
      return false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/github/token", { method: "DELETE", credentials: "include" });
      if (!res.ok) return;
      await check();
    } catch {}
  }, [check]);

  return {
    isConnected: githubStatus.canWrite,
    canRead: githubStatus.canRead,
    canWrite: githubStatus.canWrite,
    hasServerToken: githubStatus.hasServerToken,
    status: githubStatus.status,
    statusLabel: githubStatus.label,
    tokenHeader: githubStatus.tokenHeader,
    isLoading,
    error,
    connect,
    disconnect,
  };
}
