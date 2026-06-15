import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Search, Plug, Github, Calendar, CreditCard, MessageSquare,
  Briefcase, Phone, Users, Plus, Globe, Train, Sparkles, MousePointerClick,
  Check, ShieldCheck, AlertCircle, Trash2, Loader2,
} from "lucide-react";

/* ─── Backend types (GET /api/connections) ─────────────────────────────── */
type BackendConnection = {
  id: number;
  type: "github" | "railway" | "lovable" | "cursor";
  label: string;
  url: string | null;
  metadata: Record<string, any> | null;
  status: string;
  hasToken: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Mock data — replace with API once Cursor wires the Neon backend.
 * See "DEVELOPER HANDOFF SPEC" at the bottom of this file for payload shapes.
 * ───────────────────────────────────────────────────────────────────────── */


type ActiveConnection = {
  id: string;
  numericId: number;
  provider: "github" | "railway" | "lovable" | "cursor" | "google_calendar" | "stripe" | "slack" | "salesforce" | "twilio" | "hubspot" | "custom";
  label: string;
  account: string;
  status: "connected" | "read_only" | "degraded" | "expired";
  statusLabel: string;
  scopesGranted: number;
  scopesAvailable: number;
  lastSyncIso: string;
  meta?: Record<string, any>;
};

type DirectoryConnector = {
  id: string;
  provider: ActiveConnection["provider"];
  label: string;
  tagline: string;
  category: "Dev" | "Productivity" | "Payments" | "Comms" | "CRM" | "Telephony";
  popular?: boolean;
};

type EndpointPreset = {
  id: "custom" | "railway" | "lovable" | "cursor";
  label: string;
  hint: string;
  enabled: boolean;
};

const MOCK_DIRECTORY: DirectoryConnector[] = [
  { id: "dir_gcal",   provider: "google_calendar", label: "Google Calendar", tagline: "Sync events into your Ledger.",           category: "Productivity", popular: true },
  { id: "dir_stripe", provider: "stripe",          label: "Stripe",           tagline: "Pull MRR, churn, and payouts.",            category: "Payments",     popular: true },
  { id: "dir_slack",  provider: "slack",           label: "Slack",            tagline: "Capture decisions from threads.",          category: "Comms",        popular: true },
  { id: "dir_sf",     provider: "salesforce",      label: "Salesforce",       tagline: "Mirror your pipeline into Atlas.",         category: "CRM" },
  { id: "dir_twilio", provider: "twilio",          label: "Twilio",           tagline: "Programmable SMS + voice triggers.",       category: "Telephony" },
  { id: "dir_hub",    provider: "hubspot",         label: "HubSpot",          tagline: "Sync contacts, deals, and lifecycle.",     category: "CRM" },
];

const ENDPOINT_PRESETS: EndpointPreset[] = [
  { id: "custom",  label: "CUSTOM",  hint: "Coming soon — backend not ready",     enabled: false },
  { id: "railway", label: "RAILWAY", hint: "Coming soon — needs token field",     enabled: false },
  { id: "lovable", label: "LOVABLE", hint: "Lovable Cloud function URL",          enabled: true },
  { id: "cursor",  label: "CURSOR",  hint: "Cursor MCP bridge endpoint",          enabled: true },
];

function statusToActive(s: string): ActiveConnection["status"] {
  if (s === "failed") return "degraded";
  if (s === "expired") return "expired";
  if (s === "read_only") return "read_only";
  return "connected";
}
function niceStatus(s: string): string {
  if (s === "ok" || s === "connected") return "Connected";
  if (s === "failed") return "Degraded";
  if (s === "expired") return "Token expired";
  if (s === "read_only") return "Read-only";
  if (s === "pending") return "Pending check";
  return s;
}
function mapBackend(c: BackendConnection): ActiveConnection {
  return {
    id: String(c.id),
    numericId: c.id,
    provider: c.type,
    label: c.label,
    account: c.url ?? c.metadata?.repo ?? "—",
    status: statusToActive(c.status),
    statusLabel: niceStatus(c.status),
    scopesGranted: 0,
    scopesAvailable: 0,
    lastSyncIso: c.lastCheckedAt ?? c.createdAt,
    meta: c.metadata ?? undefined,
  };
}

/* ─── Icon mapping ──────────────────────────────────────────────────────── */
function ProviderIcon({ provider, size = 18 }: { provider: ActiveConnection["provider"]; size?: number }) {
  const props = { size, strokeWidth: 1.6 } as const;
  switch (provider) {
    case "github":          return <Github {...props} />;
    case "google_calendar": return <Calendar {...props} />;
    case "stripe":          return <CreditCard {...props} />;
    case "slack":           return <MessageSquare {...props} />;
    case "salesforce":      return <Briefcase {...props} />;
    case "twilio":          return <Phone {...props} />;
    case "hubspot":         return <Users {...props} />;
    case "railway":         return <Train {...props} />;
    case "lovable":         return <Sparkles {...props} />;
    case "cursor":          return <MousePointerClick {...props} />;
    default:                return <Plug {...props} />;
  }
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ───────────────────────────────────────────────────────────────────────── */

export default function ConnectorsPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");

  const [endpointPreset, setEndpointPreset] = useState<EndpointPreset["id"]>("lovable");
  const [customLabel, setCustomLabel] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customSaved, setCustomSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: active = [], isLoading, error } = useQuery<ActiveConnection[]>({
    queryKey: ["connections"],
    queryFn: async () => {
      const res = await fetch("/api/connections", { credentials: "include" });
      if (!res.ok) throw new Error(`GET /api/connections → ${res.status}`);
      const rows = (await res.json()) as BackendConnection[];
      return Array.isArray(rows) ? rows.map(mapBackend) : [];
    },
  });

  const createMut = useMutation({
    mutationFn: async (body: { type: "lovable" | "cursor"; label: string; url: string }) => {
      const res = await fetch("/api/connections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`POST /api/connections → ${res.status} ${txt}`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      setCustomSaved(true);
      setCustomLabel("");
      setCustomUrl("");
      setFormError(null);
      setTimeout(() => setCustomSaved(false), 1800);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/connections/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`DELETE /api/connections/${id} → ${res.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connections"] }),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MOCK_DIRECTORY;
    return MOCK_DIRECTORY.filter((c) =>
      [c.label, c.tagline, c.category].some((v) => v.toLowerCase().includes(q)),
    );
  }, [query]);

  const handleSaveCustom = () => {
    setFormError(null);
    if (!customLabel.trim() || !customUrl.trim()) return;
    if (endpointPreset !== "lovable" && endpointPreset !== "cursor") return;
    createMut.mutate({
      type: endpointPreset,
      label: customLabel.trim(),
      url: customUrl.trim(),
    });
  };

  const handleDelete = (conn: ActiveConnection) => {
    if (!window.confirm(`Remove "${conn.label}" connection?`)) return;
    deleteMut.mutate(conn.numericId);
  };


  return (
    <div
      style={{
        height: "100dvh",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        background:
          "radial-gradient(1200px 600px at 20% -10%, rgba(230,198,135,0.06), transparent 60%), " +
          "radial-gradient(900px 500px at 90% 10%, rgba(6,182,212,0.04), transparent 65%), " +
          "var(--atlas-surface)",
        color: "var(--atlas-fg)",
        fontFamily: "var(--app-font-mono)",
      }}
    >
      {/* Header */}
      <header
        style={{
          position: "sticky", top: 0, zIndex: 10,
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
          background: "color-mix(in oklab, var(--atlas-surface) 78%, transparent)",
          borderBottom: "1px solid var(--atlas-border)",
        }}
      >
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => setLocation("/home")}
            aria-label="Back"
            style={{
              width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center",
              border: "1px solid var(--atlas-border)", background: "transparent", color: "var(--atlas-muted)", cursor: "pointer",
            }}
          >
            <ArrowLeft size={16} strokeWidth={1.6} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
              Ecosystem
            </div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--atlas-fg)" }}>
              Connectors
            </h1>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, color: "var(--atlas-muted)", fontSize: 11 }}>
            <ShieldCheck size={14} strokeWidth={1.6} style={{ color: "var(--atlas-phosphor)" }} />
            <span>{active.length} active · {MOCK_DIRECTORY.length} available · scroll for more ↓</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 18px calc(env(safe-area-inset-bottom, 0px) + 160px)", display: "flex", flexDirection: "column", gap: 36, WebkitOverflowScrolling: "touch" }}>
        {/* ─── 1. ACTIVE CONNECTIONS ────────────────────────────────────── */}
        <section>
          <SectionHead
            eyebrow="Active"
            title="Live connections"
            subtitle="Endpoints currently feeding Atlas with signal."
          />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14, marginTop: 14 }}>
            {isLoading && (
              <div style={{ border: "1px dashed var(--atlas-border)", borderRadius: 14, padding: 22, color: "var(--atlas-muted)", fontSize: 12, textAlign: "center", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Loader2 size={14} className="animate-spin" /> Loading connections…
              </div>
            )}
            {error && !isLoading && (
              <div style={{ border: "1px solid var(--atlas-gold-border)", borderRadius: 14, padding: 22, color: "var(--atlas-gold)", fontSize: 12, textAlign: "center" }}>
                Couldn’t load connections. {(error as Error).message}
              </div>
            )}
            {!isLoading && active.map((c) => (
              <ActiveCard
                key={c.id}
                conn={c}
                onDelete={() => handleDelete(c)}
                deleting={deleteMut.isPending && deleteMut.variables === c.numericId}
              />
            ))}
            {!isLoading && !error && active.length === 0 && (
              <div
                style={{
                  border: "1px dashed var(--atlas-border)", borderRadius: 14, padding: 22,
                  color: "var(--atlas-muted)", fontSize: 12, textAlign: "center",
                }}
              >
                Nothing connected yet. Provision a Lovable or Cursor endpoint below.
              </div>
            )}
          </div>

        </section>

        {/* ─── 2. DISCOVERY GRID ────────────────────────────────────────── */}
        <section>
          <SectionHead
            eyebrow="Discover"
            title="Build from what you already use"
            subtitle="Plug Atlas into the systems your work already lives in."
          />

          {/* Search */}
          <div
            style={{
              marginTop: 14, display: "flex", alignItems: "center", gap: 10,
              border: "1px solid var(--atlas-border)", borderRadius: 12, padding: "10px 12px",
              background: "color-mix(in oklab, var(--atlas-surface-alt) 75%, transparent)",
            }}
          >
            <Search size={15} strokeWidth={1.6} style={{ color: "var(--atlas-muted)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Stripe, Slack, Salesforce…"
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "var(--atlas-fg)", fontSize: 13, fontFamily: "var(--app-font-mono)",
              }}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                style={{
                  border: "none", background: "transparent", color: "var(--atlas-muted)",
                  fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
                }}
              >
                clear
              </button>
            )}
          </div>

          {/* Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginTop: 16 }}>
            {filtered.map((dir) => (
              <DirectoryCard key={dir.id} dir={dir} />
            ))}

            {filtered.length === 0 && (
              <div style={{ color: "var(--atlas-muted)", fontSize: 12, padding: 16 }}>
                No matches for &ldquo;{query}&rdquo;.
              </div>
            )}
          </div>
        </section>

        {/* ─── 3. CUSTOM PROVISIONING ───────────────────────────────────── */}
        <section>
          <SectionHead
            eyebrow="Provision"
            title="Custom endpoint"
            subtitle="Point Atlas at any internal or third-party service."
          />

          <div
            style={{
              marginTop: 14, borderRadius: 16, padding: 20,
              border: "1px solid var(--atlas-border)",
              background:
                "linear-gradient(180deg, color-mix(in oklab, var(--atlas-surface-alt) 90%, transparent), " +
                "color-mix(in oklab, var(--atlas-surface) 95%, transparent))",
              backdropFilter: "blur(18px)",
              boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 24px 60px -30px rgba(0,0,0,0.6)",
            }}
          >
            {/* Preset chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
              {ENDPOINT_PRESETS.map((p) => {
                const selected = endpointPreset === p.id;
                const Icon =
                  p.id === "railway" ? Train :
                  p.id === "lovable" ? Sparkles :
                  p.id === "cursor"  ? MousePointerClick :
                  Globe;
                const disabled = !p.enabled;
                return (
                  <button
                    key={p.id}
                    onClick={() => !disabled && setEndpointPreset(p.id)}
                    disabled={disabled}
                    title={disabled ? "Coming soon" : undefined}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 7,
                      padding: "7px 12px", borderRadius: 999,
                      cursor: disabled ? "not-allowed" : "pointer",
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
                      fontFamily: "var(--app-font-mono)",
                      border: `1px solid ${selected ? "var(--atlas-gold)" : "var(--atlas-border)"}`,
                      color: disabled ? "var(--atlas-muted)" : selected ? "var(--atlas-gold)" : "var(--atlas-muted)",
                      background: selected
                        ? "color-mix(in oklab, var(--atlas-gold) 10%, transparent)"
                        : "transparent",
                      boxShadow: selected ? "0 0 0 3px var(--atlas-gold-dim)" : "none",
                      opacity: disabled ? 0.45 : 1,
                      transition: "all 160ms ease",
                    }}
                  >
                    <Icon size={12} strokeWidth={1.8} />
                    {p.label}{disabled ? " · SOON" : ""}
                  </button>
                );
              })}
            </div>


            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
              <Field
                label="Custom label"
                value={customLabel}
                onChange={setCustomLabel}
                placeholder="e.g. Internal CRM"
              />
              <Field
                label="Destination URL"
                value={customUrl}
                onChange={setCustomUrl}
                placeholder={
                  endpointPreset === "railway" ? "https://service.up.railway.app" :
                  endpointPreset === "lovable" ? "https://your-project.lovable.app/api" :
                  endpointPreset === "cursor"  ? "cursor://mcp/bridge/your-tool" :
                  "https://api.your-domain.com/atlas"
                }
                mono
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
              <div style={{ fontSize: 10, color: "var(--atlas-muted)", letterSpacing: "0.08em" }}>
                {ENDPOINT_PRESETS.find((p) => p.id === endpointPreset)?.hint}
              </div>
              <div style={{ flex: 1 }} />
              {customSaved && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--atlas-phosphor)", fontSize: 11 }}>
                  <Check size={13} strokeWidth={2} /> Provisioned
                </span>
              )}
              {formError && (
                <span style={{ color: "var(--atlas-gold)", fontSize: 11 }}>{formError}</span>
              )}
              <button
                disabled={!customLabel.trim() || !customUrl.trim() || createMut.isPending}
                onClick={handleSaveCustom}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "9px 16px", borderRadius: 10,
                  border: "1px solid var(--atlas-gold)",
                  color: "var(--atlas-gold)",
                  background: "color-mix(in oklab, var(--atlas-gold) 8%, transparent)",
                  cursor: !customLabel.trim() || !customUrl.trim() || createMut.isPending ? "not-allowed" : "pointer",
                  opacity: !customLabel.trim() || !customUrl.trim() || createMut.isPending ? 0.45 : 1,
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
                  fontFamily: "var(--app-font-mono)",
                  boxShadow: "0 0 24px -10px var(--atlas-gold-glow)",
                }}
              >
                {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} strokeWidth={2.2} />}
                {createMut.isPending ? "Provisioning…" : "Provision endpoint"}
              </button>

            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ─── Subcomponents ─────────────────────────────────────────────────────── */

function SectionHead({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 6 }}>
        {eyebrow}
      </div>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em" }}>{title}</h2>
      <p style={{ margin: "6px 0 0", color: "var(--atlas-muted)", fontSize: 13 }}>{subtitle}</p>
    </div>
  );
}

function ActiveCard({ conn, onDelete, deleting }: { conn: ActiveConnection; onDelete: () => void; deleting: boolean }) {
  const warn = conn.status === "read_only" || conn.status === "degraded" || conn.status === "expired";
  const showScopes = conn.scopesGranted > 0 || conn.scopesAvailable > 0;
  return (
    <article
      style={{
        position: "relative", borderRadius: 16, padding: 16,
        border: "1px solid var(--atlas-border)",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--atlas-surface-alt) 95%, transparent), " +
          "color-mix(in oklab, var(--atlas-surface) 92%, transparent))",
        backdropFilter: "blur(20px) saturate(150%)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset, 0 30px 60px -36px rgba(0,0,0,0.7), 0 0 0 1px rgba(230,198,135,0.04)",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center",
            background: "color-mix(in oklab, var(--atlas-gold) 8%, transparent)",
            border: "1px solid var(--atlas-gold-border)",
            color: "var(--atlas-gold)",
          }}
        >
          <ProviderIcon provider={conn.provider} size={18} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--atlas-fg)" }}>{conn.label}</div>
            <span
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: warn ? "var(--atlas-gold)" : "var(--atlas-phosphor)",
                boxShadow: warn
                  ? "0 0 10px var(--atlas-gold-glow)"
                  : "0 0 10px color-mix(in oklab, var(--atlas-phosphor) 50%, transparent)",
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--atlas-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {conn.account}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 9px", borderRadius: 999,
          border: `1px solid ${warn ? "var(--atlas-gold-border)" : "var(--atlas-border)"}`,
          background: warn ? "color-mix(in oklab, var(--atlas-gold) 8%, transparent)" : "transparent",
          color: warn ? "var(--atlas-gold)" : "var(--atlas-phosphor)",
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
        }}
      >
        {warn ? <AlertCircle size={11} strokeWidth={2} /> : <Check size={11} strokeWidth={2.2} />}
        {conn.statusLabel}
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--atlas-border)", fontSize: 10, color: "var(--atlas-muted)", letterSpacing: "0.06em", alignItems: "center" }}>
        {showScopes && <span>SCOPES · {conn.scopesGranted}/{conn.scopesAvailable}</span>}
        <span>SYNCED · {timeAgo(conn.lastSyncIso)}</span>
        <button
          onClick={onDelete}
          disabled={deleting}
          style={{
            marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
            color: "var(--atlas-muted)", cursor: deleting ? "not-allowed" : "pointer",
            background: "transparent", border: "none", padding: 0,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
            fontFamily: "var(--app-font-mono)",
          }}
        >
          {deleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} strokeWidth={1.8} />}
          {deleting ? "Removing…" : "Remove"}
        </button>
      </div>
    </article>

  );
}

function DirectoryCard({ dir }: { dir: DirectoryConnector }) {
  const [hover, setHover] = useState(false);
  return (
    <article
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", borderRadius: 14, padding: 16,
        border: `1px solid ${hover ? "var(--atlas-gold-border)" : "var(--atlas-border)"}`,
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--atlas-surface-alt) 90%, transparent), " +
          "color-mix(in oklab, var(--atlas-surface) 94%, transparent))",
        backdropFilter: "blur(16px)",
        transform: hover ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hover
          ? "0 24px 50px -30px rgba(0,0,0,0.7), 0 0 0 1px var(--atlas-gold-border), 0 0 30px -18px var(--atlas-gold-glow)"
          : "0 1px 0 rgba(255,255,255,0.03) inset, 0 18px 40px -32px rgba(0,0,0,0.6)",
        transition: "all 200ms ease",
        cursor: "default",
      }}
    >
      {dir.popular && (
        <span
          style={{
            position: "absolute", top: 12, right: 12,
            fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "var(--atlas-gold)", opacity: 0.85,
          }}
        >
          Popular
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center",
            border: "1px solid var(--atlas-border)",
            background: "color-mix(in oklab, var(--atlas-surface) 85%, transparent)",
            color: "var(--atlas-fg)",
          }}
        >
          <ProviderIcon provider={dir.provider} size={17} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{dir.label}</div>
          <div style={{ fontSize: 10, color: "var(--atlas-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {dir.category}
          </div>
        </div>
      </div>

      <p style={{ margin: "12px 0 16px", fontSize: 12, color: "var(--atlas-muted)", lineHeight: 1.5 }}>
        {dir.tagline}
      </p>

      <button
        disabled
        title="OAuth flow not built yet"
        style={{
          width: "100%", padding: "9px 12px", borderRadius: 10, cursor: "not-allowed",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
          fontFamily: "var(--app-font-mono)",
          border: "1px solid var(--atlas-border)",
          color: "var(--atlas-muted)",
          background: "transparent",
          opacity: 0.7,
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
        }}
      >
        Coming soon
      </button>

    </article>
  );
}

function Field({
  label, value, onChange, placeholder, mono,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--atlas-muted)" }}>
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "11px 12px", borderRadius: 10,
          border: "1px solid var(--atlas-border)",
          background: "color-mix(in oklab, var(--atlas-surface) 80%, transparent)",
          color: "var(--atlas-fg)", outline: "none",
          fontSize: 13, fontFamily: mono ? "var(--app-font-mono)" : "var(--app-font-mono)",
          transition: "border-color 160ms ease, box-shadow 160ms ease",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--atlas-gold)";
          e.currentTarget.style.boxShadow = "0 0 0 3px var(--atlas-gold-dim)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--atlas-border)";
          e.currentTarget.style.boxShadow = "none";
        }}
      />
    </label>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * DEVELOPER HANDOFF SPEC — for Cursor + Neon backend wiring
 *
 * Replace MOCK_ACTIVE, MOCK_DIRECTORY with `useQuery` calls to these endpoints.
 * All requests must send `credentials: "include"` (atlas-session cookie).
 *
 * ── GET /api/connectors/active ────────────────────────────────────────────
 *   200 → ActiveConnection[]
 *
 *   ActiveConnection = {
 *     id:              string;            // "conn_<provider>_<n>"
 *     provider:        "github" | "google_calendar" | "stripe" | "slack"
 *                    | "salesforce" | "twilio" | "hubspot" | "custom";
 *     label:           string;
 *     account:         string;            // user-visible identifier
 *     status:          "connected" | "read_only" | "degraded" | "expired";
 *     statusLabel:     string;            // human badge text
 *     scopesGranted:   number;
 *     scopesAvailable: number;
 *     lastSyncIso:     string;            // ISO 8601
 *     meta?:           Record<string,string>;
 *   };
 *
 * ── GET /api/connectors/directory ─────────────────────────────────────────
 *   200 → DirectoryConnector[]
 *
 *   DirectoryConnector = {
 *     id:       string;
 *     provider: <same enum as above>;
 *     label:    string;
 *     tagline:  string;
 *     category: "Dev" | "Productivity" | "Payments" | "Comms" | "CRM" | "Telephony";
 *     popular?: boolean;
 *   };
 *
 * ── POST /api/connectors/connect ──────────────────────────────────────────
 *   body:  { directoryId: string }
 *   200 →  { redirectUrl: string } | { connection: ActiveConnection }
 *
 * ── POST /api/connectors/custom ───────────────────────────────────────────
 *   body:  {
 *     label:  string;                       // required, 1-64
 *     url:    string;                       // required, https:// or cursor://
 *     preset: "custom"|"railway"|"lovable"|"cursor";
 *   }
 *   200 →  { connection: ActiveConnection }
 *
 * ── DELETE /api/connectors/active/:id ─────────────────────────────────────
 *   200 →  { ok: true }
 *
 * Suggested Neon schema:
 *   CREATE TABLE connectors (
 *     id            text PRIMARY KEY,
 *     user_id       integer REFERENCES users(id) ON DELETE CASCADE,
 *     provider      text NOT NULL,
 *     label         text NOT NULL,
 *     account       text NOT NULL,
 *     status        text NOT NULL,
 *     status_label  text NOT NULL,
 *     scopes_granted   integer NOT NULL DEFAULT 0,
 *     scopes_available integer NOT NULL DEFAULT 0,
 *     last_sync_at  timestamptz,
 *     meta          jsonb,
 *     custom_url    text,
 *     custom_preset text,
 *     created_at    timestamptz NOT NULL DEFAULT now()
 *   );
 * ───────────────────────────────────────────────────────────────────────── */
