import { useEffect, useMemo, useState } from "react";
import { Search, LayoutGrid, List, FileText, FileCode2, FileImage, FileJson, Folder, X } from "lucide-react";
import type { GhTreeItem, LinkedRepo } from "../../pages/workspace";

type FileEntry = {
  path: string;
  name: string;
  ext: string;
  size: number;
  daysAgo?: number;
};

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function iconFor(ext: string) {
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext)) return FileImage;
  if (["json", "yml", "yaml", "toml"].includes(ext)) return FileJson;
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "css", "scss", "html", "sh"].includes(ext)) return FileCode2;
  return FileText;
}

function fmtAge(d?: number) {
  if (d == null) return "—";
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${Math.floor(d)} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} y ago`;
}

export function ObsidianFileBrowser({
  linkedRepo,
  onOpenFile,
}: {
  linkedRepo: LinkedRepo | null;
  onOpenFile: (path: string, content: string) => void;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "grid">("list");
  const [search, setSearch] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!linkedRepo) return;
    setLoading(true);
    setError(null);
    fetch(`/api/github/tree?repo=${encodeURIComponent(linkedRepo.fullName)}&branch=${linkedRepo.defaultBranch ?? "main"}`, {
      headers: { "x-github-token": "__account__" },
      credentials: "include",
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { tree: GhTreeItem[] }) => {
        const blobs: FileEntry[] = data.tree
          .filter((i) => i.type === "blob")
          .map((i) => ({
            path: i.path,
            name: i.path.split("/").pop() ?? i.path,
            ext: extOf(i.path),
            size: 0,
          }));
        setFiles(blobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [linkedRepo?.fullName, linkedRepo?.defaultBranch]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, search]);

  async function openFile(f: FileEntry) {
    if (!linkedRepo) return;
    try {
      const r = await fetch(
        `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(f.path)}&branch=${linkedRepo.defaultBranch ?? "main"}`,
        { headers: { "x-github-token": "__account__" }, credentials: "include" },
      );
      const data = await r.json();
      onOpenFile(f.path, data.content ?? "");
    } catch (e) {
      // swallow
    }
  }

  // Lazily fetch a short text preview for grid cards
  useEffect(() => {
    if (view !== "grid" || !linkedRepo) return;
    const targets = filtered.slice(0, 30).filter((f) => !previews[f.path] && ["ts","tsx","js","jsx","md","json","html","css"].includes(f.ext));
    if (targets.length === 0) return;
    let cancel = false;
    (async () => {
      for (const f of targets) {
        if (cancel) return;
        try {
          const r = await fetch(
            `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(f.path)}&branch=${linkedRepo.defaultBranch ?? "main"}`,
            { headers: { "x-github-token": "__account__" }, credentials: "include" },
          );
          const d = await r.json();
          if (cancel) return;
          setPreviews((p) => ({ ...p, [f.path]: String(d.content ?? "").slice(0, 600) }));
        } catch {}
      }
    })();
    return () => { cancel = true; };
  }, [view, filtered, linkedRepo, previews]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
          background: "color-mix(in oklab, var(--atlas-bg) 70%, transparent)",
          backdropFilter: "blur(20px)",
          flexShrink: 0,
        }}
      >
        <div style={{ position: "relative", flex: 1, maxWidth: 520 }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--atlas-muted)", opacity: 0.6 }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            style={{
              width: "100%",
              padding: "9px 30px 9px 32px",
              background: "color-mix(in oklab, var(--atlas-bg) 80%, transparent)",
              border: "1px solid color-mix(in oklab, var(--atlas-gold) 14%, transparent)",
              borderRadius: 8,
              color: "var(--atlas-fg)",
              fontFamily: "var(--app-font-mono)",
              fontSize: 12,
              outline: "none",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "color-mix(in oklab, var(--atlas-gold) 38%, transparent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "color-mix(in oklab, var(--atlas-gold) 14%, transparent)")}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", padding: 4 }}
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: 3,
            borderRadius: 8,
            background: "color-mix(in oklab, var(--atlas-bg) 80%, transparent)",
            border: "1px solid color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
          }}
        >
          {(["list", "grid"] as const).map((m) => {
            const active = view === m;
            const Icon = m === "list" ? List : LayoutGrid;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                aria-label={`${m} view`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 26,
                  borderRadius: 6,
                  background: active ? "color-mix(in oklab, var(--atlas-gold) 16%, transparent)" : "transparent",
                  border: "none",
                  color: active ? "var(--atlas-gold)" : "var(--atlas-muted)",
                  cursor: "pointer",
                }}
              >
                <Icon size={13} strokeWidth={1.8} />
              </button>
            );
          })}
        </div>

        <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.12em", color: "var(--atlas-muted)", opacity: 0.6, textTransform: "uppercase", marginLeft: "auto" }}>
          {filtered.length} {filtered.length === 1 ? "file" : "files"}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: view === "grid" ? 16 : 0 }}>
        {!linkedRepo && (
          <EmptyState title="No repo linked" detail="Link a GitHub repo to browse files." />
        )}
        {loading && <EmptyState title="Loading…" detail="Fetching repository tree." />}
        {error && <EmptyState title="Error" detail={error} />}
        {!loading && !error && linkedRepo && filtered.length === 0 && (
          <EmptyState title="No matches" detail="Try a different search." />
        )}

        {view === "list" && filtered.length > 0 && (
          <div>
            {filtered.map((f) => {
              const Icon = iconFor(f.ext);
              return (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => openFile(f)}
                  style={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns: "28px 1fr auto auto",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 18px",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 5%, transparent)",
                    color: "var(--atlas-fg)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 140ms ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-gold) 5%, transparent)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Icon size={15} strokeWidth={1.6} style={{ color: "var(--atlas-gold)", opacity: 0.7 }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, color: "var(--atlas-fg)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </span>
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.55, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.path}
                    </span>
                  </span>
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", color: "var(--atlas-muted)", textTransform: "uppercase", opacity: 0.5 }}>
                    {f.ext || "file"}
                  </span>
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.55, minWidth: 80, textAlign: "right" }}>
                    {fmtAge(f.daysAgo)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {view === "grid" && filtered.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 14,
            }}
          >
            {filtered.map((f) => {
              const Icon = iconFor(f.ext);
              const preview = previews[f.path];
              const isImg = ["png","jpg","jpeg","gif","webp","svg"].includes(f.ext);
              return (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => openFile(f)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    background: "color-mix(in oklab, var(--atlas-bg) 75%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
                    borderRadius: 12,
                    overflow: "hidden",
                    cursor: "pointer",
                    textAlign: "left",
                    color: "var(--atlas-fg)",
                    backdropFilter: "blur(12px)",
                    transition: "border-color 160ms ease, transform 160ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "color-mix(in oklab, var(--atlas-gold) 35%, transparent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "color-mix(in oklab, var(--atlas-gold) 12%, transparent)";
                  }}
                >
                  <div
                    style={{
                      height: 110,
                      padding: 10,
                      overflow: "hidden",
                      background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.18))",
                      borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 8%, transparent)",
                      position: "relative",
                    }}
                  >
                    {isImg && linkedRepo ? (
                      <img
                        src={`https://raw.githubusercontent.com/${linkedRepo.fullName}/${linkedRepo.defaultBranch ?? "main"}/${f.path}`}
                        alt={f.name}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    ) : preview ? (
                      <pre style={{ margin: 0, fontSize: 8, lineHeight: 1.35, color: "var(--atlas-muted)", opacity: 0.75, whiteSpace: "pre-wrap", overflow: "hidden", maxHeight: "100%", fontFamily: "var(--app-font-mono)" }}>
                        {preview}
                      </pre>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                        <Icon size={32} strokeWidth={1.2} style={{ color: "var(--atlas-gold)", opacity: 0.4 }} />
                      </div>
                    )}
                  </div>
                  <div style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <Icon size={11} strokeWidth={1.6} style={{ color: "var(--atlas-gold)", opacity: 0.7, flexShrink: 0 }} />
                      <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.name}
                      </span>
                    </div>
                    <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.path.split("/").slice(0, -1).join("/") || "/"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ padding: "60px 24px", textAlign: "center" }}>
      <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.7, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "var(--atlas-muted)", opacity: 0.6 }}>{detail}</div>
    </div>
  );
}
