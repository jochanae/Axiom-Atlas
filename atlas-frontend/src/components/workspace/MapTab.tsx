import { useState } from "react";
import { useGetProject, getGetProjectQueryKey, updateProject, useUpdateProject, Project } from "@workspace/api-client-react";
import type React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { getAuthHeaders } from "@/lib/api";
import { parseLinkedRepo } from "@/lib/githubRepo";
import type { ProjectScan } from "@/pages/workspace";

function MapSection({ label, items, color = "var(--atlas-muted)" }: { label: string; items: string[]; color?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
        textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.5, marginBottom: 7,
      }}>
        {label} <span style={{ opacity: 0.5 }}>({items.length})</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {items.map((item) => (
          <span key={item} style={{
            padding: "3px 8px", borderRadius: 4,
            background: "var(--atlas-glass-bg)", border: "1px solid var(--atlas-border)",
            fontSize: "var(--ts-sm)", fontFamily: "var(--app-font-mono)",
            color, opacity: 0.8,
          }}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function MapTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const updateProject = useUpdateProject();

  const scanKey = `atlas-scan-${projectId}`;
  const [scan, setScan] = useState<ProjectScan | null>(() => {
    try {
      const raw = localStorage.getItem(scanKey);
      return raw ? JSON.parse(raw) as ProjectScan : null;
    } catch { return null; }
  });
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToMemory, setSavedToMemory] = useState(false);

  const { data: mapProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const token = mapProject?.githubToken ?? null;
  const linkedRepo = parseLinkedRepo(mapProject?.linkedRepo);

  const saveMapToMemory = (data: ProjectScan, existingMemory: string) => {
    const scanBlock = [
      `[Project map — ${data.repo} — scanned ${data.scannedAt.slice(0, 10)}]`,
      data.description ? `Description: ${data.description}` : "",
      data.stack?.length ? `Stack: ${data.stack.join(", ")}` : "",
      data.routes?.length ? `Routes (${data.routes.length}): ${data.routes.slice(0, 12).join(", ")}` : "",
      data.pages?.length ? `Pages: ${data.pages.slice(0, 12).join(", ")}` : "",
      data.tables?.length ? `Tables: ${data.tables.join(", ")}` : "",
      `Auth: ${data.authEnabled ? "enabled" : "not found"}`,
      `Total files: ${data.totalFiles}`,
    ].filter(Boolean).join("\n");

    // Replace any previous project map block, or append
    const MAP_RE = /\[Project map —[^\]]*\][^\[]*/g;
    const stripped = existingMemory.replace(MAP_RE, "").trim();
    const updated = stripped ? `${stripped}\n\n${scanBlock}` : scanBlock;

    updateProject.mutate(
      { id: projectId, data: { memory: updated } },
      { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) }); setSavedToMemory(true); } }
    );
  };

  const handleScan = async () => {
    if (!linkedRepo || !token) return;
    setScanning(true);
    setError(null);
    setSavedToMemory(false);
    try {
      const res = await fetch("/api/github/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders(), "x-github-token": token },
        body: JSON.stringify({ repo: linkedRepo.fullName, branch: linkedRepo.defaultBranch }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as any;
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json() as ProjectScan;
      setScan(data);
      try { localStorage.setItem(scanKey, JSON.stringify(data)); } catch {}
      // Auto-save to Atlas memory so every future chat knows the structure
      saveMapToMemory(data, project?.memory ?? "");
    } catch (e: any) {
      setError(e.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };

  if (!linkedRepo) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 18px", gap: 12 }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity={0.2}>
          <rect x="1" y="1" width="30" height="30" rx="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 10h16M8 16h12M8 22h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <div style={{ textAlign: "center", fontSize: "var(--ts-caption)", color: "var(--atlas-muted)", lineHeight: 1.7 }}>
          Link a repo in the <strong style={{ color: "var(--atlas-fg)", opacity: 0.65 }}>Files</strong> tab first,<br />
          then come back here to map your project.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px", borderBottom: "1px solid var(--atlas-border)",
        flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--ts-micro)", ...sMono, letterSpacing: "0.08em", color: "var(--atlas-muted)", opacity: 0.5 }}>
            {linkedRepo.fullName}
          </div>
          {scan && (
            <div style={{ fontSize: "var(--ts-xs)", ...sMono, color: "var(--atlas-muted)", opacity: 0.3, marginTop: 1 }}>
              Scanned {scan.scannedAt.slice(0, 10)} · {scan.totalFiles} files
            </div>
          )}
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          style={{
            padding: "5px 12px", borderRadius: 5, fontSize: "var(--ts-micro)", fontWeight: 600,
            ...sMono, letterSpacing: "0.08em",
            background: scanning
              ? "rgba(var(--atlas-muted-rgb),0.15)"
              : "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)",
            color: scanning ? "var(--atlas-muted)" : "var(--atlas-bg)",
            border: "none", cursor: scanning ? "not-allowed" : "pointer",
            transition: "all 160ms ease", flexShrink: 0,
          }}
        >
          {scanning ? "Scanning…" : scan ? "Re-scan" : "Scan Project"}
        </button>
      </div>

      {/* Scanning spinner */}
      {scanning && (
        <div style={{ padding: "24px 14px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center" }}><LoadingSpinner size="sm" color="atlas" /></div>
          <div style={{ marginTop: 10, fontSize: "var(--ts-micro)", ...sMono, color: "var(--atlas-muted)", opacity: 0.45 }}>
            Reading key files and mapping structure…
          </div>
        </div>
      )}

      {/* Error */}
      {error && !scanning && (
        <div style={{
          margin: "10px 12px", padding: "9px 12px", borderRadius: 6,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
          fontSize: "var(--ts-caption)", color: "rgba(252,165,165,0.8)",
        }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!scan && !scanning && !error && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 18px", gap: 10 }}>
          <div style={{ fontSize: "var(--ts-sm)", color: "var(--atlas-muted)", lineHeight: 1.8, textAlign: "center", opacity: 0.55, ...sMono }}>
            Click <strong style={{ color: "var(--atlas-gold)" }}>Scan Project</strong> to map<br />
            your routes, components, and tables.
          </div>
        </div>
      )}

      {/* Results */}
      {scan && !scanning && (
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 20px" }} className="scrollbar-none">
          {/* Project name + summary */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: "var(--ts-md)", fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 5 }}>
              {scan.projectName}
            </div>
            <div style={{ fontSize: "var(--ts-label)", color: "var(--atlas-fg)", opacity: 0.65, lineHeight: 1.7 }}>
              {scan.summary}
            </div>
          </div>

          {/* Stack badges */}
          {scan.stack && scan.stack.length > 0 && (
            <div style={{ marginBottom: 18, display: "flex", flexWrap: "wrap", gap: 5 }}>
              {scan.stack.map((s) => (
                <span key={s} style={{
                  padding: "3px 9px", borderRadius: 20,
                  background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.2)",
                  fontSize: "var(--ts-micro)", fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", opacity: 0.85,
                }}>
                  {s}
                </span>
              ))}
              {scan.authEnabled && (
                <span style={{
                  padding: "3px 9px", borderRadius: 20,
                  background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)",
                  fontSize: "var(--ts-micro)", fontFamily: "var(--app-font-mono)", color: "rgba(134,239,172,0.85)",
                }}>
                  Auth ✓
                </span>
              )}
            </div>
          )}

          <MapSection label="Routes" items={scan.routes || []} color="rgba(147,197,253,0.8)" />
          <MapSection label="Pages" items={scan.pages || []} color="rgba(216,180,254,0.8)" />
          <MapSection label="Components" items={scan.components || []} color="var(--atlas-fg)" />
          <MapSection label="Supabase Tables" items={scan.tables || []} color="rgba(110,231,183,0.8)" />

          {/* Stats row */}
          <div style={{
            marginTop: 4, marginBottom: 18, padding: "9px 12px", borderRadius: 7,
            background: "rgba(255,255,255,0.025)", border: "1px solid var(--atlas-border)",
            display: "flex", gap: 20,
          }}>
            {[
              ["Routes", scan.routes?.length ?? 0],
              ["Components", scan.components?.length ?? 0],
              ["Tables", scan.tables?.length ?? 0],
              ["Files", scan.totalFiles],
            ].map(([label, val]) => (
              <div key={label as string} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "var(--ts-h3)", fontWeight: 700, color: "var(--atlas-fg)" }}>{val}</div>
                <div style={{ fontSize: "var(--ts-xs)", ...sMono, color: "var(--atlas-muted)", opacity: 0.45, letterSpacing: "0.06em" }}>
                  {label as string}
                </div>
              </div>
            ))}
          </div>

          {/* Memory save status — auto-saved after every scan */}
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "8px 11px", borderRadius: 6,
            background: savedToMemory ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.025)",
            border: `1px solid ${savedToMemory ? "rgba(34,197,94,0.2)" : "var(--atlas-border)"}`,
            transition: "all 300ms ease",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: savedToMemory ? "#34d399" : "var(--atlas-muted)", opacity: savedToMemory ? 1 : 0.3 }} />
            <span style={{ fontSize: "var(--ts-micro)", ...sMono, color: savedToMemory ? "rgba(134,239,172,0.8)" : "var(--atlas-muted)", opacity: savedToMemory ? 1 : 0.45, letterSpacing: "0.04em" }}>
              {updateProject.isPending ? "Saving to memory…" : savedToMemory ? "Saved to Atlas memory — active in chat" : "Scan to save map to Atlas memory"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
