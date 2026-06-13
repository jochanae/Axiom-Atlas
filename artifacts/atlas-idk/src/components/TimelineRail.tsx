import { useEffect, useMemo, useRef, useState } from "react";

type RailMessage = {
  role: "user" | "assistant";
  createdAt?: string;
  hasSurfacedMemory?: boolean;
  text?: string;
};

type Bucket = {
  label: string;
  firstIdx: number;
  count: number;
};

function dayLabel(t: number, now: number): string {
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const weekStart = today - 6 * 86_400_000;
  if (t >= today) return "TODAY";
  if (t >= yesterday) return "YESTERDAY";
  if (t >= weekStart) {
    return new Date(t).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  }
  // Older — use MMM D
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

function bucketize(messages: RailMessage[]): Bucket[] {
  const now = Date.now();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(new Date(now));
  const yesterday = today - 86_400_000;
  const weekStart = today - 6 * 86_400_000;

  const buckets: Record<string, Bucket> = {};
  const order = ["Today", "Yesterday", "This week", "Older"];

  messages.forEach((m, i) => {
    if (m.role !== "assistant") return;
    const t = m.createdAt ? new Date(m.createdAt).getTime() : now;
    let label = "Older";
    if (t >= today) label = "Today";
    else if (t >= yesterday) label = "Yesterday";
    else if (t >= weekStart) label = "This week";
    if (!buckets[label]) buckets[label] = { label, firstIdx: i, count: 0 };
    buckets[label].count += 1;
  });

  return order.filter((l) => buckets[l]).map((l) => buckets[l]);
}

export function TimelineRail({
  messages,
  topOffset = 92,
  bottomOffset = 90,
}: {
  messages: RailMessage[];
  topOffset?: number;
  bottomOffset?: number;
}) {
  const [showOverlay, setShowOverlay] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const longPressRef = useRef<number | null>(null);
  const didLongPressRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Sorted list of message indices that contain the query.
  const matchList = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as number[];
    const out: number[] = [];
    messages.forEach((m, i) => {
      if (m.text && m.text.toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [messages, query]);
  const matchingIdx = useMemo(() => new Set(matchList), [matchList]);

  useEffect(() => {
    if (showSearch) {
      const t = window.setTimeout(() => searchInputRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
  }, [showSearch]);

  // ── DOM highlight effect: wrap query matches inside every chat bubble with a
  // <mark class="atlas-search-hit"> span; tear down cleanly when query clears.
  useEffect(() => {
    const HIT_CLASS = "atlas-search-hit";
    const HIT_ACTIVE = "atlas-search-hit--active";

    const unwrapAll = () => {
      document.querySelectorAll<HTMLElement>(`.${HIT_CLASS}`).forEach((el) => {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        (parent as HTMLElement).normalize?.();
      });
    };

    unwrapAll();
    const q = query.trim();
    if (!q) return;

    const lower = q.toLowerCase();
    const roots = document.querySelectorAll<HTMLElement>("[data-msg-idx]");
    roots.forEach((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest("script,style,textarea,input")) return NodeFilter.FILTER_REJECT;
          if (parent.classList.contains(HIT_CLASS)) return NodeFilter.FILTER_REJECT;
          return node.nodeValue.toLowerCase().includes(lower) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      const targets: Text[] = [];
      let n: Node | null = walker.nextNode();
      while (n) { targets.push(n as Text); n = walker.nextNode(); }

      targets.forEach((textNode) => {
        const text = textNode.nodeValue ?? "";
        const lowerText = text.toLowerCase();
        const frag = document.createDocumentFragment();
        let i = 0;
        while (i < text.length) {
          const found = lowerText.indexOf(lower, i);
          if (found === -1) {
            frag.appendChild(document.createTextNode(text.slice(i)));
            break;
          }
          if (found > i) frag.appendChild(document.createTextNode(text.slice(i, found)));
          const mark = document.createElement("mark");
          mark.className = HIT_CLASS;
          mark.textContent = text.slice(found, found + lower.length);
          frag.appendChild(mark);
          i = found + lower.length;
        }
        textNode.parentNode?.replaceChild(frag, textNode);
      });
    });

    // Tag the active match for distinct styling.
    document.querySelectorAll(`.${HIT_ACTIVE}`).forEach((el) => el.classList.remove(HIT_ACTIVE));
    const activeMsgIdx = matchList[cursor];
    if (activeMsgIdx !== undefined) {
      const el = document.querySelector<HTMLElement>(`[data-msg-idx="${activeMsgIdx}"]`);
      el?.querySelector(`.${HIT_CLASS}`)?.classList.add(HIT_ACTIVE);
    }

    return () => { unwrapAll(); };
  }, [query, matchList, cursor]);

  // Reset cursor when the match set changes.
  useEffect(() => { setCursor(0); }, [query]);



  // Track which message is closest to vertical viewport center.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const compute = () => {
      const centerY = window.innerHeight / 2;
      let best = -1;
      let bestDist = Infinity;
      const nodes = document.querySelectorAll<HTMLElement>("[data-msg-idx]");
      nodes.forEach((n) => {
        const r = n.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        const mid = (r.top + r.bottom) / 2;
        const d = Math.abs(mid - centerY);
        if (d < bestDist) {
          bestDist = d;
          best = Number(n.getAttribute("data-msg-idx"));
        }
      });
      setFocusIdx(best);
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; compute(); });
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true } as any);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [messages.length]);


  // One dot per unique date — collapse all messages on the same day into a single dot.
  const dateDots = useMemo(() => {
    const now = Date.now();
    const dayKey = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    const groups = new Map<string, {
      key: string;
      label: string;
      firstIdx: number;
      lastIdx: number;
      msgIdxs: number[];
      hasMemory: boolean;
      timestamp: number;
    }>();
    messages.forEach((m, i) => {
      if (m.role !== "assistant") return;
      const t = m.createdAt ? new Date(m.createdAt).getTime() : now;
      const key = dayKey(t);
      const existing = groups.get(key);
      if (existing) {
        existing.lastIdx = i;
        existing.msgIdxs.push(i);
        if (m.hasSurfacedMemory) existing.hasMemory = true;
      } else {
        groups.set(key, {
          key,
          label: dayLabel(t, now),
          firstIdx: i,
          lastIdx: i,
          msgIdxs: [i],
          hasMemory: !!m.hasSurfacedMemory,
          timestamp: t,
        });
      }
    });
    return Array.from(groups.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [messages]);

  const buckets = useMemo(() => bucketize(messages), [messages]);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const MOVE_CANCEL_PX = 6;

  useEffect(
    () => () => {
      if (longPressRef.current) window.clearTimeout(longPressRef.current);
    },
    [],
  );

  if (dateDots.length === 0) return null;
  const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";

  const scrollTo = (idx: number) => {
    const el = document.querySelector<HTMLElement>(`[data-msg-idx="${idx}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const startPress = (e: React.TouchEvent | React.MouseEvent) => {
    didLongPressRef.current = false;
    const point =
      "touches" in e && e.touches[0]
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : "clientX" in e
          ? { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY }
          : null;
    pressStartRef.current = point;
    longPressRef.current = window.setTimeout(() => {
      didLongPressRef.current = true;
      setShowOverlay(true);
    }, 550);
  };
  const movePress = (e: React.TouchEvent | React.MouseEvent) => {
    if (!pressStartRef.current || !longPressRef.current) return;
    const cur =
      "touches" in e && e.touches[0]
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : "clientX" in e
          ? { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY }
          : null;
    if (!cur) return;
    if (
      Math.abs(cur.x - pressStartRef.current.x) > MOVE_CANCEL_PX ||
      Math.abs(cur.y - pressStartRef.current.y) > MOVE_CANCEL_PX
    ) {
      endPress();
    }
  };
  const endPress = () => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
    pressStartRef.current = null;
  };


  const matchedDateKeys = new Set<string>();
  if (matchList.length > 0) {
    dateDots.forEach((d) => {
      if (d.msgIdxs.some((i) => matchingIdx.has(i))) matchedDateKeys.add(d.key);
    });
  }
  const focusedDateKey = (() => {
    if (focusIdx < 0) return null;
    for (const d of dateDots) {
      if (focusIdx >= d.firstIdx && focusIdx <= d.lastIdx) return d.key;
    }
    return null;
  })();

  return (
    <>
      {/* Narrow long-press strip on the right edge — cancels on scroll/move to avoid accidental triggers. */}
      <div
        aria-label="Conversation timeline (long-press to jump)"
        onMouseDown={startPress}
        onMouseMove={movePress}
        onMouseUp={endPress}
        onMouseLeave={endPress}
        onTouchStart={startPress}
        onTouchMove={movePress}
        onTouchEnd={endPress}
        onTouchCancel={endPress}
        style={{
          position: "fixed",
          top: topOffset,
          bottom: bottomOffset,
          right: 0,
          width: 14,
          zIndex: 17,
          pointerEvents: "auto",
          background: "transparent",
        }}
      />


      {/* Rail is hidden by default — appears only during long-press overlay below. */}


      {/* Search affordance — small, top-right, always reachable */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setShowSearch((v) => !v); }}
        title="Search this thread"
        aria-label="Search this thread"
        style={{
          position: "fixed",
          top: topOffset - 2,
          right: 8,
          width: 28,
          height: 28,
          borderRadius: 999,
          background: "var(--atlas-search-btn-bg, rgba(20,17,14,0.72))",
          border: "1px solid var(--atlas-search-btn-border, rgba(201,162,76,0.45))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          backdropFilter: "blur(6px)",
          boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
          zIndex: 19,
          padding: 0,
          color: "var(--atlas-search-btn-fg, rgba(201,162,76,0.95))",
          transition: "transform 140ms ease, background 140ms ease",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="20" y1="20" x2="16.2" y2="16.2" />
        </svg>
      </button>

      {/* Long-press "golden thread" overlay — Compani style */}
      {showOverlay && (
        <>
          <div
            onClick={() => setShowOverlay(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 200,
              background: "rgba(0,0,0,0.35)",
              backdropFilter: "blur(2px)",
              animation: "fadeIn 200ms ease",
            }}
          />
          <div
            role="dialog"
            aria-label="Jump to date"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: "20%",
              bottom: "20%",
              right: 12,
              width: 56,
              zIndex: 201,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              animation: "fadeIn 220ms ease",
            }}
          >
            {/* Vertical gold thread */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                width: 1,
                background:
                  "linear-gradient(to bottom, transparent, rgba(201,162,76,0.45), transparent)",
              }}
            />
            {/* Date nodes */}
            <div
              style={{
                position: "relative",
                flex: 1,
                width: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: dateDots.length <= 6 ? "center" : "flex-start",
                gap: 4,
                padding: "16px 0",
                overflowY: "auto",
                overscrollBehavior: "contain",
                scrollbarWidth: "none",
              }}
            >

              {dateDots.map((d) => {
                const isFocused = focusedDateKey === d.key;
                const isMatch = matchedDateKeys.has(d.key);
                return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => {
                    setShowOverlay(false);
                    scrollTo(d.firstIdx);
                  }}
                  aria-label={`Jump to ${d.label}`}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 10,
                    background: "transparent",
                    border: "none",
                    padding: "6px 0",
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--app-font-mono)",
                      fontSize: 9,
                      fontWeight: isFocused ? 600 : 300,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: `1px solid rgba(201,162,76,${isFocused ? 0.7 : 0.35})`,
                      background: "rgba(10,11,30,0.85)",
                      color: `rgba(201,162,76,${isFocused ? 1 : 0.9})`,
                      backdropFilter: "blur(8px)",
                      whiteSpace: "nowrap",
                      transition: "all 180ms ease",
                    }}
                  >
                    {d.label}
                  </span>
                  <span
                    style={{
                      display: "block",
                      width: isFocused ? 11 : 8,
                      height: isFocused ? 11 : 8,
                      borderRadius: "50%",
                      background: isMatch
                        ? "rgba(245,200,110,0.9)"
                        : isFocused
                          ? "rgba(201,162,76,0.7)"
                          : "rgba(201,162,76,0.3)",
                      border: `1px solid rgba(201,162,76,${isFocused ? 1 : 0.6})`,
                      boxShadow: isFocused
                        ? "0 0 12px rgba(201,162,76,0.65)"
                        : "0 0 8px rgba(201,162,76,0.35)",
                      marginRight: 18,
                      transition: "all 180ms ease",
                    }}
                  />
                </button>
                );
              })}

            </div>
          </div>
        </>
      )}

      {showSearch && (
        <div
          style={{
            position: "fixed",
            top: topOffset - 6,
            right: 40,
            zIndex: 210,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "var(--atlas-bg)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            minWidth: 280,
            animation: "fadeIn 140ms ease",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(201,162,76,0.7)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="20" y1="20" x2="16.2" y2="16.2" />
          </svg>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setShowSearch(false);
                setQuery("");
              } else if (e.key === "Enter") {
                if (matchList.length === 0) return;
                const dir = e.shiftKey ? -1 : 1;
                const next = (cursor + dir + matchList.length) % matchList.length;
                setCursor(next);
                scrollTo(matchList[next]);
              }
            }}
            placeholder="Search this thread"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--atlas-fg)",
              fontFamily: "var(--app-font-sans)",
              fontSize: 13,
            }}
          />
          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              color: matchList.length ? "rgba(201,162,76,0.85)" : "rgba(201,162,76,0.4)",
              minWidth: 36,
              textAlign: "right",
              whiteSpace: "nowrap",
            }}
          >
            {query.trim() ? (matchList.length ? `${cursor + 1} / ${matchList.length}` : "0 / 0") : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              if (matchList.length === 0) return;
              const next = (cursor - 1 + matchList.length) % matchList.length;
              setCursor(next);
              scrollTo(matchList[next]);
            }}
            aria-label="Previous match"
            disabled={matchList.length === 0}
            style={{ background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: matchList.length ? "pointer" : "not-allowed", padding: "0 2px", opacity: matchList.length ? 1 : 0.4 }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 8L6 5 3 8" /></svg>
          </button>
          <button
            type="button"
            onClick={() => {
              if (matchList.length === 0) return;
              const next = (cursor + 1) % matchList.length;
              setCursor(next);
              scrollTo(matchList[next]);
            }}
            aria-label="Next match"
            disabled={matchList.length === 0}
            style={{ background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: matchList.length ? "pointer" : "not-allowed", padding: "0 2px", opacity: matchList.length ? 1 : 0.4 }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4l3 3 3-3" /></svg>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowSearch(false);
              setQuery("");
            }}
            aria-label="Close search"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--atlas-muted)",
              cursor: "pointer",
              fontSize: 14,
              padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>
      )}

    </>
  );
}
