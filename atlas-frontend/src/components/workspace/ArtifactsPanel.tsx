import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { getAuthHeaders } from "@/lib/api";

type ArtifactRecord = {
  id: number | string;
  projectId?: number;
  sessionId?: number | null;
  type: string;
  title: string;
  content: string;
  createdAt?: string;
  created_at?: string;
};

function renderArtifactMarkdown(md: string): string {
  // Minimal markdown -> HTML (headings, bold, italic, code, links, lists, paragraphs)
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      let t = esc(para.join(" "));
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      out.push(`<p>${t}</p>`);
      para = [];
    }
  };
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const ln of lines) {
    if (ln.startsWith("```")) {
      flushPara(); closeList();
      if (!inCode) { out.push("<pre><code>"); inCode = true; }
      else { out.push("</code></pre>"); inCode = false; }
      continue;
    }
    if (inCode) { out.push(esc(ln) + "\n"); continue; }
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`); continue; }
    const li = ln.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      flushPara();
      if (!inList) { out.push("<ul>"); inList = true; }
      let t = esc(li[1]);
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out.push(`<li>${t}</li>`);
      continue;
    }
    if (ln.trim() === "") { flushPara(); closeList(); continue; }
    para.push(ln);
  }
  flushPara(); closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

export function ArtifactsPanel({ projectId }: { projectId: number }) {
  const [items, setItems] = useState<ArtifactRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/artifacts?projectId=${projectId}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const arr: ArtifactRecord[] = Array.isArray(data) ? data : (data.artifacts ?? []);
      setItems(arr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setItems([]);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = useCallback(async (id: string | number) => {
    try {
      const r = await fetch(`/api/artifacts/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error();
      setItems((prev) => (prev ?? []).filter((a) => a.id !== id));
      toast("Artifact deleted.");
    } catch {
      toast("Failed to delete artifact.");
    }
  }, []);

  const handleExport = useCallback((a: ArtifactRecord) => {
    const safe = a.title.replace(/[^a-z0-9\-_. ]+/gi, "_").slice(0, 80) || "artifact";
    const blob = new Blob([a.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${safe}.md`;
    document.body.appendChild(link); link.click();
    document.body.removeChild(link); URL.revokeObjectURL(url);
  }, []);

  const handleExportPDF = useCallback((a: ArtifactRecord) => {
    const win = window.open("", "_blank");
    if (!win) { toast("Pop-up blocked — allow pop-ups to export PDF."); return; }
    const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const bodyHtml = renderArtifactMarkdown(a.content);
    const titleEsc = escapeHtml(a.title);
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${titleEsc}</title>
<style>
  @page { size: Letter; margin: 0.75in; }
  html, body { background: #ffffff; color: #111827; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 12pt;
    line-height: 1.6;
    margin: 0;
    padding: 0.25in 0.35in;
    -webkit-font-smoothing: antialiased;
  }
  h1 { font-size: 24pt; line-height: 1.25; margin: 0 0 0.4em; font-weight: 700; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
  h2 { font-size: 18pt; line-height: 1.3; margin: 1.2em 0 0.4em; font-weight: 600; }
  h3 { font-size: 14pt; margin: 1em 0 0.35em; font-weight: 600; }
  h4, h5, h6 { font-size: 12pt; margin: 0.9em 0 0.3em; font-weight: 600; }
  p { margin: 0 0 0.75em; }
  ul, ol { margin: 0 0 0.85em 1.4em; padding: 0; }
  li { margin: 0.2em 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5pt; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
  pre { background: #f3f4f6; padding: 12px 14px; border-radius: 6px; overflow: auto; page-break-inside: avoid; }
  pre code { background: transparent; padding: 0; font-size: 10pt; }
  a { color: #2563eb; text-decoration: underline; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
</style>
</head>
<body>
  <h1>${titleEsc}</h1>
  ${bodyHtml}
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () {
        window.focus();
        window.print();
      }, 50);
    });
    window.addEventListener('afterprint', function () { window.close(); });
  </script>
</body>
</html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
  }, []);


  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 14px" }} className="scrollbar-none">
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 32, color: "var(--atlas-muted)", fontSize: "var(--ts-sm)" }}>Loading artifacts…</div>
      ) : error ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 32, color: "var(--atlas-muted)", fontSize: "var(--ts-sm)" }}>
          <div>Couldn’t load artifacts.</div>
          <button type="button" onClick={() => void load()} style={{ fontSize: "var(--ts-xs)", color: "var(--atlas-gold)", background: "transparent", border: "1px solid rgba(201,162,76,0.3)", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>Retry</button>
        </div>
      ) : !items || items.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, paddingBottom: 40 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-muted)" strokeWidth="1.2" strokeLinecap="round" style={{ opacity: 0.25 }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>
          </svg>
          <div style={{ fontSize: "var(--ts-label)", color: "var(--atlas-muted)", opacity: 0.5, textAlign: "center", lineHeight: 1.65 }}>
            No artifacts saved yet.<br />
            <span style={{ fontSize: "var(--ts-sm)" }}>Atlas-emitted artifacts appear here.</span>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((a) => {
            const isOpen = expanded === a.id;
            const created = a.createdAt ?? a.created_at ?? "";
            const dateLabel = created ? new Date(created).toLocaleString() : "";
            return (
              <div key={a.id} style={{ border: "1px solid var(--atlas-border)", borderRadius: 10, background: "var(--atlas-card)", overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                  style={{ width: "100%", textAlign: "left", padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-fg)" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--ts-sm)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                    {dateLabel && <div style={{ fontSize: "var(--ts-xs)", color: "var(--atlas-muted)", marginTop: 2 }}>{dateLabel}</div>}
                  </div>
                  <span style={{ fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", background: "rgba(201,162,76,0.12)", border: "1px solid rgba(201,162,76,0.3)", color: "var(--atlas-gold)", padding: "2px 6px", borderRadius: 6 }}>{a.type}</span>
                  <ChevronDown size={14} style={{ opacity: 0.6, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 160ms" }} />
                </button>
                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--atlas-border)", padding: "12px 14px" }}>
                    <div
                      style={{ fontSize: "var(--ts-sm)", lineHeight: 1.6, color: "var(--atlas-fg)" }}
                      className="atlas-artifact-md"
                      dangerouslySetInnerHTML={{ __html: renderArtifactMarkdown(a.content) }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button type="button" onClick={() => handleExport(a)} style={{ fontSize: "var(--ts-xs)", color: "var(--atlas-fg)", background: "transparent", border: "1px solid var(--atlas-border)", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>Export MD</button>
                      <button type="button" onClick={() => handleExportPDF(a)} style={{ fontSize: "var(--ts-xs)", color: "var(--atlas-fg)", background: "transparent", border: "1px solid var(--atlas-border)", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>Export PDF</button>
                      <button type="button" onClick={() => void handleDelete(a.id)} style={{ fontSize: "var(--ts-xs)", color: "rgb(229,115,115)", background: "transparent", border: "1px solid rgba(229,115,115,0.3)", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
