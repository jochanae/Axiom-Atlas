import { useCallback, useEffect, useState } from "react";
import { FileText, ArrowLeft, Trash2, Copy, Download, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import { BlueprintVisual } from "@/components/BlueprintVisual";

export type Blueprint = {
  id: number | string;
  projectId: number | string;
  sessionId?: number | string | null;
  title: string;
  idea?: string;
  opportunity?: string;
  mechanism?: string;
  landscape?: string;
  risks?: string[];
  openQuestions?: string[];
  nextSteps?: string[];
  visualPrompt?: string;
  createdAt: string;
};

type BlueprintListItem = Pick<Blueprint, "id" | "title" | "createdAt" | "sessionId">;

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

const GOLD = "var(--atlas-gold)";
const MUTED = "var(--atlas-muted)";
const FG = "var(--atlas-fg)";
const BORDER = "var(--atlas-border)";
const MONO = "var(--app-font-mono)";

const sectionLabelStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: GOLD,
  opacity: 0.85,
  marginBottom: 10,
};

function pulse(p: number | number[]) {
  try { if (navigator.vibrate) navigator.vibrate(p); } catch {}
  void haptics;
}

function buildMarkdown(b: Blueprint): string {
  const list = (xs?: string[]) => (xs && xs.length ? xs.map(x => `- ${x}`).join("\n") : "");
  const ordered = (xs?: string[]) => (xs && xs.length ? xs.map((x, i) => `${i + 1}. ${x}`).join("\n") : "");
  return [
    `# ${b.title}`,
    "",
    "## The Idea", b.idea ?? "",
    "",
    "## The Opportunity", b.opportunity ?? "",
    "",
    "## How It Works", b.mechanism ?? "",
    "",
    "## What Already Exists", b.landscape ?? "",
    "",
    "## Risks", list(b.risks),
    "",
    "## Open Questions", list(b.openQuestions),
    "",
    "## Next Steps", ordered(b.nextSteps),
    "",
    "## Visual", b.visualPrompt ?? "",
  ].join("\n");
}

export function BlueprintsTab({
  projectId,
  onContinueSession,
}: {
  projectId: number | string;
  onContinueSession?: (sessionId: number | string) => void;
}) {
  const [list, setList] = useState<BlueprintListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | string | null>(null);
  const [detail, setDetail] = useState<Blueprint | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/blueprints`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setList(Array.isArray(data) ? data : (data.blueprints ?? []));
    } catch (e: any) {
      setList([]);
      setListError(e?.message || "Failed to load blueprints");
    }
  }, [projectId]);

  useEffect(() => { void loadList(); }, [loadList]);

  const openBlueprint = useCallback(async (id: number | string) => {
    pulse(50);
    setOpenId(id);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/blueprints/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setDetail(data.blueprint ?? data);
    } catch (e: any) {
      setDetailError(e?.message || "Failed to load blueprint");
    } finally {
      setDetailLoading(false);
    }
  }, [projectId]);

  const closeDetail = () => { setOpenId(null); setDetail(null); setDetailError(null); };

  const handleDownload = () => {
    pulse([50, 50, 50]);
    window.print();
  };

  const handleCopyMarkdown = async () => {
    if (!detail) return;
    pulse([50, 50, 50]);
    try {
      await navigator.clipboard.writeText(buildMarkdown(detail));
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    if (!window.confirm("Delete this blueprint? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/blueprints/${detail.id}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast.success("Blueprint deleted");
      closeDetail();
      void loadList();
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    }
  };

  const handleContinue = async () => {
    if (!detail?.sessionId) { toast.error("No session linked to this blueprint"); return; }
    pulse(50);
    try {
      await fetch(`/api/sessions/${detail.sessionId}/idea-mode`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
    } catch { /* non-fatal */ }
    onContinueSession?.(detail.sessionId);
  };

  // ── Detail view ────────────────────────────────────────────────────────────
  if (openId !== null) {
    return (
      <div style={{ height: "100%", overflowY: "auto", background: "var(--atlas-bg)" }} className="blueprint-detail-root">
        <div className="screen-only" style={{ padding: "12px 14px", borderBottom: `1px solid ${BORDER}` }}>
          <button
            onClick={closeDetail}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, background: "transparent",
              border: "none", color: MUTED, fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em",
              textTransform: "uppercase", cursor: "pointer", padding: 0,
            }}
          >
            <ArrowLeft size={12} strokeWidth={1.6} /> Blueprints
          </button>
        </div>

        {detailLoading && <div style={{ padding: 32, textAlign: "center", color: MUTED, fontSize: 12 }}>Loading…</div>}
        {detailError && <div style={{ padding: 32, color: "var(--atlas-ember)", fontSize: 13 }}>{detailError}</div>}

        {detail && (
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 28px 80px", color: FG, lineHeight: 1.7 }}>
            {/* Header rule */}
            <div style={{ borderTop: `1px solid ${BORDER}`, marginBottom: 18 }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 22 }}>
              <span className="blueprint-section-label" style={{ ...sectionLabelStyle, marginBottom: 0 }}>Blueprint</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: MUTED, letterSpacing: "0.1em" }}>{fmtDate(detail.createdAt)}</span>
            </div>
            <h1 style={{
              fontSize: 28, fontWeight: 500, margin: "0 0 28px", letterSpacing: "-0.01em", lineHeight: 1.25, color: FG,
            }}>{detail.title}</h1>
            <div style={{ borderTop: `1px solid ${BORDER}`, marginBottom: 36 }} />

            <Section label="The Idea">
              <p style={{ fontSize: 19, lineHeight: 1.5, fontWeight: 400, color: FG, margin: 0 }}>{detail.idea}</p>
            </Section>

            <Section label="The Opportunity"><p style={para}>{detail.opportunity}</p></Section>
            <Section label="How It Works"><p style={para}>{detail.mechanism}</p></Section>
            <Section label="What Already Exists"><p style={para}>{detail.landscape}</p></Section>

            <Section label="Risks"><Bulleted items={detail.risks} /></Section>
            <Section label="Open Questions"><Bulleted items={detail.openQuestions} /></Section>
            <Section label="Next Steps"><Numbered items={detail.nextSteps} /></Section>

            {detail.visualPrompt && (
              <Section label="Visual">
                <BlueprintVisual
                  visualPrompt={detail.visualPrompt}
                  title={detail.title}
                  promptStyle={{
                    ...para,
                    fontStyle: "italic",
                    borderLeft: `2px solid ${GOLD}`,
                    paddingLeft: 16,
                    color: "rgba(var(--atlas-fg-rgb, 245,243,238), 0.85)",
                  }}
                />
              </Section>
            )}

            <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 24 }} />

            <div className="screen-only" style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 28 }}>
              <button onClick={handleContinue} style={btnPrimary}>
                Continue this conversation <ArrowRight size={13} strokeWidth={1.8} />
              </button>
              <button onClick={handleDownload} style={btnSecondary}>
                <Download size={12} strokeWidth={1.8} /> Download PDF
              </button>
              <button onClick={handleCopyMarkdown} style={btnSecondary}>
                <Copy size={12} strokeWidth={1.8} /> Copy as Markdown
              </button>
              <button onClick={handleDelete} style={btnMuted}>
                <Trash2 size={12} strokeWidth={1.8} /> Delete
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "16px 14px" }}>
      {list === null && <div style={{ color: MUTED, fontSize: 12, padding: 24, textAlign: "center" }}>Loading…</div>}
      {list !== null && list.length === 0 && (
        <div style={{
          padding: "48px 20px", textAlign: "center", color: MUTED,
          fontSize: 13, lineHeight: 1.7, maxWidth: 360, margin: "0 auto",
        }}>
          <FileText size={28} strokeWidth={1.3} style={{ opacity: 0.4, marginBottom: 12 }} />
          <div>No blueprints yet.</div>
          <div style={{ opacity: 0.75, marginTop: 4, marginBottom: 18 }}>
            Generate one from the current conversation, or start an idea thread.
          </div>
          <GenerateBlueprintPill projectId={projectId} onCreated={() => void loadList()} />
          {listError && (
            <div style={{ marginTop: 18, fontSize: 11, opacity: 0.5, fontFamily: MONO }}>
              {listError}
            </div>
          )}
        </div>
      )}
      {list && list.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map(bp => (
            <li
              key={bp.id}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px",
                border: `1px solid ${BORDER}`, borderRadius: 8,
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <FileText size={16} strokeWidth={1.5} style={{ color: GOLD, opacity: 0.8, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: FG, fontWeight: 500, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {bp.title}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED, letterSpacing: "0.08em", marginTop: 3 }}>
                  {fmtDate(bp.createdAt)}
                </div>
              </div>
              <button
                onClick={() => openBlueprint(bp.id)}
                style={{
                  padding: "5px 11px", borderRadius: 6,
                  background: "rgba(201,162,76,0.12)",
                  border: "1px solid rgba(201,162,76,0.3)",
                  color: GOLD, fontFamily: MONO, fontSize: 10,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const para: React.CSSProperties = { fontSize: 15, lineHeight: 1.7, color: FG, margin: 0, opacity: 0.92 };

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <div className="blueprint-section-label" style={sectionLabelStyle}>{label}</div>
      {children}
    </section>
  );
}

function Bulleted({ items }: { items?: string[] }) {
  if (!items?.length) return <p style={{ ...para, opacity: 0.5 }}>—</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, i) => <li key={i} style={para}>{it}</li>)}
    </ul>
  );
}
function Numbered({ items }: { items?: string[] }) {
  if (!items?.length) return <p style={{ ...para, opacity: 0.5 }}>—</p>;
  return (
    <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, i) => <li key={i} style={para}>{it}</li>)}
    </ol>
  );
}

const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7,
  padding: "9px 16px", borderRadius: 7,
  background: "linear-gradient(180deg, rgba(201,162,76,0.95), rgba(168,134,60,0.95))",
  border: "1px solid rgba(201,162,76,0.6)",
  color: "#1a1408", fontSize: 12, fontWeight: 600,
  letterSpacing: "0.02em", cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 7,
  background: "transparent",
  border: `1px solid ${BORDER}`,
  color: FG, fontSize: 12, cursor: "pointer", opacity: 0.85,
};
const btnMuted: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 7,
  background: "transparent",
  border: "1px solid transparent",
  color: MUTED, fontSize: 12, cursor: "pointer", opacity: 0.6,
};

// ── Generate Blueprint Pill (used above composer) ─────────────────────────────
export function GenerateBlueprintPill({
  projectId,
  onCreated,
}: {
  projectId: number | string;
  onCreated?: (blueprintId: number | string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trace = (step: string, detail?: unknown) => {
    // eslint-disable-next-line no-console
    console.log(`[blueprint] ${step}`, detail ?? "");
  };

  const readBody = async (res: Response): Promise<{ json: any; text: string }> => {
    const text = await res.text().catch(() => "");
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { json, text };
  };

  const ensureIdeaModeSession = async () => {
    setStatus("Preparing conversation context…");
    trace("ensureIdeaModeSession: list sessions", { projectId });
    const sessionsRes = await fetch(`/api/projects/${projectId}/sessions`, { credentials: "include" });
    const sessionsBody = await readBody(sessionsRes);
    trace("sessions response", { status: sessionsRes.status, body: sessionsBody.json ?? sessionsBody.text });
    if (!sessionsRes.ok) throw new Error(`List sessions failed ${sessionsRes.status}: ${sessionsBody.text.slice(0, 200)}`);

    const sessions = (sessionsBody.json ?? []) as Array<{ id: number; mode?: string | null }>;
    const preferred = sessions.find((session) => session.mode === "idea") ?? sessions[0];
    let sessionId: number | null = preferred?.id ?? null;
    trace("preferred session", { sessionId, totalSessions: sessions.length });

    if (!sessionId) {
      trace("creating new session");
      const createRes = await fetch(`/api/projects/${projectId}/sessions`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Blueprint session", mode: "idea" }),
      });
      const createBody = await readBody(createRes);
      trace("create session response", { status: createRes.status, body: createBody.json ?? createBody.text });
      if (!createRes.ok) throw new Error(`Create session failed ${createRes.status}: ${createBody.text.slice(0, 200)}`);
      sessionId = (createBody.json as { id?: number } | null)?.id ?? null;
    }
    if (!sessionId) throw new Error("No session id returned after create");

    trace("enabling idea mode", { sessionId });
    const ideaRes = await fetch(`/api/sessions/${sessionId}/idea-mode`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    const ideaBody = await readBody(ideaRes);
    trace("idea-mode response", { status: ideaRes.status, body: ideaBody.json ?? ideaBody.text });
    if (!ideaRes.ok) throw new Error(`Enable idea-mode failed ${ideaRes.status}: ${ideaBody.text.slice(0, 200)}`);
  };

  const callBlueprint = async () => {
    setStatus("Generating blueprint…");
    trace("POST /blueprint", { projectId });
    const res = await fetch(`/api/projects/${projectId}/blueprint`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await readBody(res);
    trace("blueprint response", { status: res.status, body: body.json ?? body.text });
    return { res, body };
  };

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus("Generating blueprint…");
    trace("── generate start ──", { projectId });
    try {
      let { res, body } = await callBlueprint();
      if (!res.ok) {
        const errMsg = (body.json?.error as string | undefined) ?? body.text;
        trace("first attempt failed", { status: res.status, errMsg });
        if (errMsg && /idea mode|idea-mode|conversation messages/i.test(errMsg)) {
          trace("missing idea-mode context → bootstrapping");
          await ensureIdeaModeSession();
          ({ res, body } = await callBlueprint());
        }
      }
      if (!res.ok) {
        const detail = body.json?.error ?? body.text ?? `HTTP ${res.status}`;
        throw new Error(`Blueprint API ${res.status}: ${String(detail).slice(0, 240)}`);
      }
      const bpId = body.json?.blueprint?.id ?? body.json?.id;
      trace("success", { bpId });
      setStatus(null);
      toast.success("Blueprint created.");
      onCreated?.(bpId);
    } catch (e: any) {
      const msg = e?.message || "Generation failed";
      console.error("[blueprint] FAILED", e);
      setError(msg);
      setStatus(null);
      toast.error(msg, { duration: 10000, description: "Check console for full trace." });
    } finally {
      setBusy(false);
      trace("── generate end ──");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <button
        onClick={generate}
        disabled={busy}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 14px", borderRadius: 999,
          background: "rgba(201,162,76,0.1)",
          border: "1px solid rgba(201,162,76,0.35)",
          color: GOLD, fontFamily: MONO, fontSize: 10.5,
          letterSpacing: "0.12em", textTransform: "uppercase",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          backdropFilter: "blur(8px)",
          transition: "all 160ms ease",
        }}
      >
        ✦ {busy ? "Generating…" : "Generate Blueprint"}
      </button>
      {(status || error) && (
        <div style={{
          maxWidth: 300,
          fontFamily: MONO,
          fontSize: 10,
          lineHeight: 1.5,
          color: error ? "var(--atlas-ember)" : MUTED,
          opacity: error ? 0.95 : 0.72,
          textAlign: "center",
        }}>
          {error ?? status}
        </div>
      )}
    </div>
  );
}
