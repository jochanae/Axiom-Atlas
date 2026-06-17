import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useHudFeed } from "@/hooks/useHudFeed";
import {
  clearHudEvents,
  pushHudEvent,
  setHudDocked,
  setHudEvents,
  useHudDocked,
  type HudEvent,
  type HudEventType,
} from "@/lib/hudBus";

/**
 * Listening HUD — peripheral awareness of what Atlas is extracting from the
 * live conversation.
 *
 *   Collapsed = 30px pill (top-right), shows the latest event.
 *   Expanded  = 320px obsidian-glass panel with last 5 events + timestamps.
 *
 * Visual system (locked):
 *   - Obsidian glass shell (black/45% + 20px blur, white/10 hairline border).
 *   - Amber/gold (#c9a24c) for event tag labels — premium terminal feel.
 *   - Violet pulse dot — ambient "shaping" energy of the home surface.
 *
 * Content source: `src/lib/hudBus.ts` (frontend pub/sub). Backend SSE can
 * later push onto the same bus without changing this component.
 *
 * Surface-aware filtering via `categories`:
 *   - Home (shaping):    INTENT, MEMORY, DECISION, NAVIGATED, TENSION
 *   - Workspace (build): all (default) — includes INGESTED, EXTRACTED
 */

const COGNITIVE_CATEGORIES: HudEventType[] = [
  "INTENT",
  "MEMORY",
  "DECISION",
  "NAVIGATED",
  "TENSION",
  "PROJECT",
];

const SHAPING_PERSIST_TYPES: HudEventType[] = ["INTENT", "NAVIGATED", "PROJECT"];
const HUD_EVENT_TYPES: HudEventType[] = [
  "INTENT",
  "MEMORY",
  "DECISION",
  "INGESTED",
  "NAVIGATED",
  "EXTRACTED",
  "TENSION",
  "PROJECT",
];

const AMBER = "rgb(201,162,76)";
const VIOLET = "rgb(167,139,250)";
const VIOLET_CORE = "rgb(139,92,246)";

type PersistedShapingRecord = {
  id?: unknown;
  type?: unknown;
  content?: unknown;
  payload?: unknown;
  projectName?: unknown;
  at?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  timestamp?: unknown;
};

function isHudEventType(value: unknown): value is HudEventType {
  return typeof value === "string" && HUD_EVENT_TYPES.includes(value as HudEventType);
}

function isShapingPersistType(type: HudEventType) {
  return SHAPING_PERSIST_TYPES.includes(type);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function eventTime(ev: HudEvent) {
  const ms = Date.parse(ev.at);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeShapingEntries(data: unknown): HudEvent[] {
  const container = data && typeof data === "object" ? data as { entries?: unknown; items?: unknown } : null;
  const rawEntries = Array.isArray(data)
    ? data
    : Array.isArray(container?.entries)
      ? container.entries
      : Array.isArray(container?.items)
        ? container.items
        : [];

  return rawEntries.flatMap((raw, index): HudEvent[] => {
    if (!raw || typeof raw !== "object") return [];
    const entry = raw as PersistedShapingRecord;
    if (!isHudEventType(entry.type) || !isShapingPersistType(entry.type)) return [];

    const payload = readString(entry.content) ?? readString(entry.payload);
    if (!payload) return [];

    const at =
      readString(entry.at) ??
      readString(entry.createdAt) ??
      readString(entry.created_at) ??
      readString(entry.timestamp) ??
      new Date().toISOString();
    const id =
      readString(entry.id) ??
      (typeof entry.id === "number" ? String(entry.id) : `${at}-${entry.type}-${index}`);
    const projectName = readString(entry.projectName);

    return [{
      id,
      type: entry.type,
      payload,
      ...(projectName ? { projectName } : {}),
      at,
    }];
  }).sort((a, b) => eventTime(b) - eventTime(a));
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

const FONT_MONO = "var(--app-font-mono, 'Geist Mono', ui-monospace, monospace)";
const FONT_SANS = "var(--app-font-sans, 'Geist', ui-sans-serif, system-ui)";

function EventLine({ ev, dim }: { ev: HudEvent; dim?: boolean }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        borderTop: "1px solid rgba(255,255,255,0.03)",
        opacity: dim ? 0.55 : 1,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, fontFamily: FONT_MONO, minWidth: 0 }}>
        <span style={{ fontSize: 9, letterSpacing: "0.04em", textTransform: "uppercase", color: AMBER, fontWeight: 700 }}>
          [{ev.type}]
        </span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.9)", lineHeight: 1.3, wordBreak: "break-word" }}>
          {ev.payload}
        </span>
      </div>
      <span style={{ fontSize: 9, fontFamily: FONT_MONO, color: "rgba(255,255,255,0.22)", marginTop: 2, flexShrink: 0 }}>
        {fmtTime(ev.at)}
      </span>
    </div>
  );
}

export interface ListeningHUDProps {
  /** Pin position relative to the parent container (parent must be position: relative/fixed). */
  position?: { top?: number; right?: number };
  /** Active Nexus conversation used to persist shaping history. */
  conversationId?: string | null;
  /** Hide entirely when no events yet. Default true. */
  hideWhenEmpty?: boolean;
  /** Filter event types. Default = all. Pass `COGNITIVE_CATEGORIES` for shaping surfaces. */
  categories?: HudEventType[];
  /** Label shown in the expanded panel header. */
  title?: string;
}

export function ListeningHUD({
  position = { top: 12, right: 12 },
  conversationId,
  hideWhenEmpty = true,
  categories,
  title = "Live Extraction",
}: ListeningHUDProps) {
  const allEvents = useHudFeed();
  const [expanded, setExpanded] = useState(false);
  const docked = useHudDocked();
  const [pulseKey, setPulseKey] = useState(0);
  const postedEventIdsRef = useRef<Set<string>>(new Set());
  const loadRequestRef = useRef(0);

  useEffect(() => {
    if (conversationId === undefined) return;

    const requestId = ++loadRequestRef.current;
    clearHudEvents();
    setHudDocked(false);
    postedEventIdsRef.current = new Set();

    if (!conversationId || typeof window === "undefined") return;

    const controller = new AbortController();
    fetch(`/api/nexus/shaping?conversationId=${encodeURIComponent(conversationId)}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((data: unknown) => {
        if (loadRequestRef.current !== requestId) return;
        const savedEvents = normalizeShapingEntries(data);
        postedEventIdsRef.current = new Set(savedEvents.map((ev) => ev.id));
        setHudEvents(savedEvents);
        if (savedEvents.length === 0) {
          const path = window.location.pathname + window.location.search;
          pushHudEvent("NAVIGATED", path);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [conversationId]);

  // Truthful seed: log the current route so the HUD has at least one signal.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (conversationId !== undefined) return;
    const path = window.location.pathname + window.location.search;
    pushHudEvent("NAVIGATED", path);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;

    const nextEvents = allEvents.filter((ev) => isShapingPersistType(ev.type) && !postedEventIdsRef.current.has(ev.id));
    for (const ev of nextEvents) {
      postedEventIdsRef.current.add(ev.id);
      const projectName = ev.projectName ?? (ev.type === "PROJECT" ? ev.payload : undefined);

      void fetch("/api/nexus/shaping", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          type: ev.type,
          content: ev.payload,
          projectName,
        }),
      });
    }
  }, [allEvents, conversationId]);

  const events = categories
    ? allEvents.filter((e) => categories.includes(e.type))
    : allEvents;

  // Bump pulse on new event arrival.
  useEffect(() => {
    if (events.length > 0) setPulseKey((k) => k + 1);
  }, [events.length]);

  if (docked) return null;
  if (events.length === 0 && hideWhenEmpty) return null;

  const latest = events[0];
  const visible = events.slice(0, 5);

  const wrapStyle: CSSProperties = {
    position: "absolute",
    top: position.top,
    right: position.right,
    zIndex: 40,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
    maxWidth: 320,
    pointerEvents: "auto",
  };

  if (!expanded) {
    return (
      <div style={wrapStyle}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Expand listening feed"
          style={{
            height: 30,
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(8,8,10,0.55)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(167,139,250,0.18)",
            cursor: "pointer",
            color: "inherit",
            maxWidth: "100%",
          }}
        >
          <PulseDot key={pulseKey} />
          {latest && (
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_MONO, fontSize: 10, minWidth: 0 }}>
              <span style={{ color: AMBER, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                [{latest.type}]
              </span>
              <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 300 }}>→</span>
              <span style={{ color: "rgba(255,255,255,0.92)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                {latest.payload}
              </span>
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div
        style={{
          width: 320,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(8,8,10,0.6)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.65), 0 0 0 1px rgba(167,139,250,0.1)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <PulseDot key={pulseKey} />
            <span style={{ fontFamily: FONT_SANS, fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.8)", letterSpacing: "-0.005em" }}>
              {title}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <IconBtn label="Collapse" onClick={() => setExpanded(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
              </svg>
            </IconBtn>
            <IconBtn label="Dock" onClick={() => { setExpanded(false); setHudDocked(true); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </IconBtn>
          </div>
        </div>

        {/* Feed — scrollable when content exceeds max height */}
        <div style={{ maxHeight: 280, overflowY: "auto", overscrollBehavior: "contain" }}>
          {visible.length === 0 && (
            <div style={{ padding: "20px 12px", textAlign: "center", fontFamily: FONT_MONO, fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              waiting for signal…
            </div>
          )}
          {visible.map((ev, i) => (
            <EventLine key={ev.id} ev={ev} dim={i === visible.length - 1 && visible.length === 5} />
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "8px 12px", background: "rgba(201,162,76,0.05)", display: "flex", justifyContent: "center" }}>
          <div style={{ height: 2, width: 32, borderRadius: 999, background: "rgba(255,255,255,0.1)" }} />
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        padding: 4,
        background: "transparent",
        border: "none",
        color: "rgba(255,255,255,0.3)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.75)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
    >
      {children}
    </button>
  );
}

function PulseDot() {
  return (
    <span style={{ position: "relative", display: "inline-flex", height: 8, width: 8, flexShrink: 0 }}>
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 999,
          background: VIOLET,
          opacity: 0.55,
          animation: "atlas-hud-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite",
        }}
      />
      <span
        style={{
          position: "absolute",
          inset: -2,
          borderRadius: 999,
          background: VIOLET_CORE,
          opacity: 0.25,
          animation: "atlas-hud-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite 0.4s",
        }}
      />
      <span
        style={{
          position: "relative",
          display: "inline-block",
          height: 8,
          width: 8,
          borderRadius: 999,
          background: VIOLET_CORE,
          boxShadow: "0 0 8px rgba(139,92,246,0.6)",
        }}
      />
      <style>{`
        @keyframes atlas-hud-ping {
          0% { transform: scale(1); opacity: 0.6; }
          75%, 100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
    </span>
  );
}

/**
 * HudDockChip — small dot/chip rendered when the HUD is docked.
 * Tap to re-expand the floating pill.
 */
export function HudDockChip() {
  const docked = useHudDocked();
  if (!docked) return null;
  return (
    <button
      type="button"
      onClick={() => setHudDocked(false)}
      aria-label="Re-open listening feed"
      title="Listening feed"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 18,
        padding: "0 8px",
        marginLeft: 6,
        borderRadius: 999,
        border: "1px solid rgba(167,139,250,0.28)",
        background: "rgba(139,92,246,0.10)",
        color: "rgba(255,255,255,0.7)",
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        cursor: "pointer",
        verticalAlign: "middle",
      }}
    >
      <PulseDot />
    </button>
  );
}

export { COGNITIVE_CATEGORIES };
export default ListeningHUD;
