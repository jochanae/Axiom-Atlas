import { useEffect, useMemo, useRef, useState } from "react";

type RailMessage = {
  role: "user" | "assistant";
  createdAt?: string;
  hasSurfacedMemory?: boolean;
  text?: string;
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
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

/**
 * TimelineRail — always-visible Compani-style chronological rail.
 *
 * A thin vertical gold line runs along the right edge of the chat. One circle
 * node per unique date (chips: TODAY / YESTERDAY / weekday / MMM D) sits along
 * the rail. As the user scrolls, the dot closest to viewport center brightens
 * and its label expands. Tap any dot to smooth-scroll to that date's first
 * message. The search magnifier above the rail is preserved.
 */
export function TimelineRail({
  messages,
  topOffset = 92,
  bottomOffset = 90,
  alwaysVisible = false,
}: {
  messages: RailMessage[];
  topOffset?: number;
  bottomOffset?: number;
  alwaysVisible?: boolean;
}) {
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  // DOM highlight effect for search hits.
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

    document.querySelectorAll(`.${HIT_ACTIVE}`).forEach((el) => el.classList.remove(HIT_ACTIVE));
    const activeMsgIdx = matchList[cursor];
    if (activeMsgIdx !== undefined) {
      const el = document.querySelector<HTMLElement>(`[data-msg-idx="${activeMsgIdx}"]`);
      el?.querySelector(`.${HIT_CLASS}`)?.classList.add(HIT_ACTIVE);
    }

    return () => { unwrapAll(); };
  }, [query, matchList, cursor]);

  useEffect(() => { setCursor(0); }, [query]);

  // Track focused message + which message indices are currently in viewport +
  // the bounding rect of the chat scroll container so the rail stretches along
  // it instead of hanging off the global header.
  const [visibleIdxs, setVisibleIdxs] = useState<Set<number>>(new Set());
  const [containerRect, setContainerRect] = useState<{ top: number; bottom: number; right: number } | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const scrollIdleTimer = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const compute = () => {
      const container = document.querySelector<HTMLElement>(".atlas-chat-timeline, .atlas-home-chat-messages-scroll");
      const cr = container?.getBoundingClientRect();
      const viewportTop = cr ? Math.max(0, cr.top) : 0;
      const viewportBottom = cr ? Math.min(window.innerHeight, cr.bottom) : window.innerHeight;
      const centerY = (viewportTop + viewportBottom) / 2;
      let best = -1;
      let bestDist = Infinity;
      const visible = new Set<number>();
      const nodes = document.querySelectorAll<HTMLElement>("[data-msg-idx]");
      nodes.forEach((n) => {
        const r = n.getBoundingClientRect();
        if (r.bottom < viewportTop || r.top > viewportBottom) return;
        const idx = Number(n.getAttribute("data-msg-idx"));
        visible.add(idx);
        const mid = (r.top + r.bottom) / 2;
        const d = Math.abs(mid - centerY);
        if (d < bestDist) {
          bestDist = d;
          best = idx;
        }
      });
      setFocusIdx(best);
      setVisibleIdxs(visible);

      // Anchor the rail to the chat scroll container, not the viewport/header.
      if (cr) {
        setContainerRect({ top: cr.top, bottom: window.innerHeight - cr.bottom, right: window.innerWidth - cr.right });
      }
    };
    const markScrolling = () => {
      setIsScrolling(true);
      if (scrollIdleTimer.current) window.clearTimeout(scrollIdleTimer.current);
      scrollIdleTimer.current = window.setTimeout(() => setIsScrolling(false), 1100);
    };
    const onScroll = () => {
      markScrolling();
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; compute(); });
    };
    const container = document.querySelector<HTMLElement>(".atlas-chat-timeline, .atlas-home-chat-messages-scroll");
    compute();
    container?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll);
    return () => {
      container?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll, { capture: true } as never);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
      if (scrollIdleTimer.current) window.clearTimeout(scrollIdleTimer.current);
    };
  }, [messages.length]);


  // One dot per unique date across all messages (user + assistant).
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

  const scrollTo = (idx: number) => {
    const el = document.querySelector<HTMLElement>(`[data-msg-idx="${idx}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      {/* Search magnifier — preserved, top-right */}
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

      {/* Scroll-linked chronological rail — Compani style.
          Only the dates whose messages are currently in viewport render, and
          the rail fades in only while the user is scrolling or hovering it. */}
      {(() => {
        const visibleDots = dateDots.filter((d) => d.msgIdxs.some((i) => visibleIdxs.has(i)));
        const displayDots = visibleDots.length > 0 ? visibleDots : alwaysVisible ? dateDots.slice(0, 1) : [];
        if (displayDots.length === 0) return null;
        const railVisible = alwaysVisible || isScrolling || isHovering;
        const railTop = containerRect ? Math.max(containerRect.top, topOffset) : topOffset + 32;
        const railBottom = containerRect ? Math.max(containerRect.bottom, bottomOffset) : bottomOffset;
        const railRight = containerRect ? Math.max(containerRect.right, 4) : 6;
        return (
        <div
          aria-label="Conversation timeline"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          style={{
            position: "fixed",
            top: railTop,
            bottom: railBottom,
            right: railRight,
            width: 14,
            zIndex: 18,
            pointerEvents: railVisible ? "auto" : "none",
            opacity: railVisible ? 1 : 0,
            transition: "opacity 260ms ease",
          }}
        >

          {/* Vertical gold thread */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              right: 6,
              width: 1,
              background:
                "linear-gradient(to bottom, transparent, rgba(201,162,76,0.35) 8%, rgba(201,162,76,0.35) 92%, transparent)",
            }}
          />
          <div
            style={{
              position: "relative",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: displayDots.length <= 4 ? "space-around" : "space-between",
              padding: "4px 0",
            }}
          >
            {displayDots.map((d) => {
              const isFocused = focusedDateKey === d.key;
              const isMatch = matchedDateKeys.has(d.key);
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => scrollTo(d.firstIdx)}
                  aria-label={`Jump to ${d.label}`}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 6,
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    width: "100%",
                    pointerEvents: "auto",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--app-font-mono)",
                      fontSize: 8.5,
                      fontWeight: isFocused ? 600 : 300,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: `1px solid rgba(201,162,76,${isFocused ? 0.65 : 0.28})`,
                      background: isFocused ? "rgba(10,11,30,0.92)" : "rgba(10,11,30,0.55)",
                      color: `rgba(201,162,76,${isFocused ? 1 : 0.6})`,
                      backdropFilter: "blur(8px)",
                      whiteSpace: "nowrap",
                      transition: "all 200ms ease",
                      opacity: isFocused ? 1 : 0.75,
                    }}
                  >
                    {d.label}
                  </span>
                  <span
                    style={{
                      display: "block",
                      width: isFocused ? 9 : 6,
                      height: isFocused ? 9 : 6,
                      borderRadius: "50%",
                      background: isMatch
                        ? "rgba(245,200,110,0.95)"
                        : isFocused
                          ? "rgba(201,162,76,0.85)"
                          : "rgba(201,162,76,0.35)",
                      border: `1px solid rgba(201,162,76,${isFocused ? 1 : 0.55})`,
                      boxShadow: isFocused
                        ? "0 0 10px rgba(201,162,76,0.6)"
                        : "0 0 4px rgba(201,162,76,0.25)",
                      marginRight: 2,
                      transition: "all 200ms ease",
                      flexShrink: 0,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        );
      })()}

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
