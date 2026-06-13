import { useEffect, useRef, useState, type CSSProperties } from "react";

const mono: CSSProperties = { fontFamily: "'IBM Plex Mono', 'Courier New', monospace" };
const serif: CSSProperties = { fontFamily: "'Cormorant Garamond', Georgia, serif" };

function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(true); },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

/* ──────────────────────────────────────────────────────────
   02 — INTERROGATION (fragment cadence)
   ────────────────────────────────────────────────────────── */
type Fragment = { text: string; tone: "bright" | "dim" | "gold" };

const FRAGMENTS: Fragment[] = [
  { text: "You had the idea.", tone: "bright" },
  { text: "You had momentum.", tone: "dim" },
  { text: "Then the architecture shifted.", tone: "dim" },
  { text: "Most ideas don't fail. They drift.", tone: "gold" },
];

export function InterrogationFragments() {
  // First fragment lit by default so the section is never a blank black block
  // on initial render, SSR, or Lovable's static build snapshot (no scroll fired yet).
  const [lit, setLit] = useState<boolean[]>(() => FRAGMENTS.map((_, i) => i === 0));
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setLit(FRAGMENTS.map(() => true));
      return;
    }

    // Sync pass on mount: light up anything already on screen before the first scroll event fires.
    const vh = window.innerHeight;
    setLit((prev) => {
      const next = [...prev];
      itemRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.top < vh * 0.6) next[i] = true;
      });
      return next;
    });

    const observers: IntersectionObserver[] = [];
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setLit((prev) => {
              if (prev[i]) return prev;
              const next = [...prev];
              next[i] = true;
              return next;
            });
            obs.disconnect();
          }
        },
        { threshold: 0, rootMargin: "0px 0px -40% 0px" },
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const litCount = lit.filter(Boolean).length;
  const railFill = litCount / FRAGMENTS.length;

  return (
    <section className="relative z-10 py-24 md:py-32 px-6">
      <div className="max-w-3xl mx-auto w-full relative" style={{ paddingLeft: 28 }}>
        <div
          className="absolute left-0 w-px"
          style={{ top: 64, bottom: 48, background: "rgba(212,175,55,0.12)" }}
        />
        <div
          className="absolute left-0 w-px"
          style={{
            top: 64,
            height: `calc((100% - 112px) * ${railFill})`,
            background: "linear-gradient(180deg, rgba(212,175,55,0.7), rgba(212,175,55,0.35))",
            transition: "height 600ms cubic-bezier(0.16,1,0.3,1)",
          }}
        />

        <p
          className="uppercase tracking-[0.35em] mb-12"
          style={{ ...mono, fontSize: "0.65rem", color: "#6b5f50" }}
        >
          02 // The Interrogation
        </p>

        <div className="space-y-16 md:space-y-24">
          {FRAGMENTS.map((f, i) => {
            const on = lit[i];
            const baseColor = f.tone === "dim" ? "rgba(232,220,200,0.78)" : "#e8dcc8";
            return (
              <div
                key={i}
                ref={(el) => { itemRefs.current[i] = el; }}
                className="relative"
                style={{
                  opacity: on ? 1 : 0.22,
                  transform: on ? "translateY(0)" : "translateY(14px)",
                  transition: "opacity 900ms cubic-bezier(0.16,1,0.3,1), transform 900ms cubic-bezier(0.16,1,0.3,1)",
                }}
              >
                <div
                  className="absolute"
                  style={{
                    left: -32,
                    top: 18,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#D4AF37",
                    opacity: on ? 1 : 0.2,
                    boxShadow: on ? "0 0 12px rgba(212,175,55,0.55)" : "none",
                    transition: "opacity 600ms ease-out, box-shadow 600ms ease-out",
                  }}
                />
                <p
                  style={{
                    ...serif,
                    fontWeight: 400,
                    fontSize: "clamp(1.6rem, 4.5vw, 2.6rem)",
                    lineHeight: 1.25,
                    color: baseColor,
                    margin: 0,
                    letterSpacing: "-0.005em",
                  }}
                >
                  {f.tone === "gold" ? (
                    <>
                      Most ideas don't fail. They{" "}
                      <span style={{ fontStyle: "italic", color: "#D4AF37", fontWeight: 500 }}>drift.</span>
                    </>
                  ) : (
                    f.text
                  )}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-12 flex gap-2" aria-hidden="true">
          {FRAGMENTS.map((_, i) => (
            <div
              key={i}
              style={{
                height: 1,
                flex: 1,
                background: `rgba(212,175,55,${lit[i] ? 0.55 : 0.08})`,
                transition: "background 500ms ease-out",
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────
   03 — STRATEGIC MANIFEST (lens system)
   ────────────────────────────────────────────────────────── */
type Lens = "storyteller" | "designer" | "builder";

export function StrategicManifest() {
  const { ref, visible } = useReveal(0.1);
  const [lens, setLens] = useState<Lens>("designer");

  const chips: { id: Lens; label: string }[] = [
    { id: "storyteller", label: "Storyteller" },
    { id: "designer", label: "Designer" },
    { id: "builder", label: "Builder" },
  ];

  return (
    <section ref={ref} className="relative z-10 py-28 md:py-40 px-6">
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 h-px transition-all duration-[1.2s] ease-out"
        style={{
          width: visible ? "80%" : "0%",
          background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)",
        }}
      />

      <div className="max-w-3xl mx-auto">
        <p
          className="uppercase tracking-[0.35em] mb-4 text-center"
          style={{
            ...mono,
            fontSize: "0.65rem",
            color: "#6b5f50",
            opacity: visible ? 1 : 0,
            transition: "opacity 700ms",
          }}
        >
          03 // Strategic Manifest
        </p>

        <h2
          className="text-center mb-3"
          style={{
            ...serif,
            fontWeight: 400,
            fontSize: "clamp(1.8rem, 4.5vw, 3rem)",
            lineHeight: 1.15,
            color: "#e8dcc8",
            letterSpacing: "-0.01em",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(16px)",
            transition: "all 900ms ease-out",
          }}
        >
          One idea.{" "}
          <span style={{ fontStyle: "italic", color: "#D4AF37", fontWeight: 500 }}>Three lenses.</span>
        </h2>

        <p
          className="text-center mb-10 italic"
          style={{
            ...serif,
            fontSize: "clamp(0.95rem, 1.8vw, 1.05rem)",
            color: "rgba(232,220,200,0.55)",
            maxWidth: 360,
            margin: "0 auto 40px",
            lineHeight: 1.5,
            opacity: visible ? 1 : 0,
            transition: "opacity 900ms ease-out 200ms",
          }}
        >
          The same seed, seen the way you need to see it.
        </p>

        {/* Seed */}
        <div
          className="mx-auto mb-7"
          style={{
            ...mono,
            fontSize: "0.78rem",
            color: "rgba(232,220,200,0.7)",
            textAlign: "center",
            padding: "14px 16px",
            border: "1px dashed rgba(212,175,55,0.25)",
            borderRadius: 4,
            maxWidth: 420,
            opacity: visible ? 1 : 0,
            transition: "opacity 700ms ease-out 300ms",
          }}
        >
          <span style={{ color: "rgba(232,220,200,0.35)", marginRight: 8 }}>// seed:</span>
          a weekly podcast about cities.
        </div>

        {/* Lens chips */}
        <div
          role="tablist"
          aria-label="Lens"
          className="flex"
          style={{
            borderBottom: "1px solid rgba(232,220,200,0.08)",
            marginBottom: 28,
            opacity: visible ? 1 : 0,
            transition: "opacity 700ms ease-out 400ms",
          }}
        >
          {chips.map((c) => {
            const active = c.id === lens;
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={active}
                onClick={() => setLens(c.id)}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  padding: "14px 4px",
                  marginBottom: -1,
                  ...mono,
                  fontSize: "0.68rem",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: active ? "#D4AF37" : "rgba(232,220,200,0.35)",
                  borderBottom: active ? "1px solid #D4AF37" : "1px solid transparent",
                  cursor: "pointer",
                  transition: "color 220ms ease, border-color 220ms ease",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "rgba(232,220,200,0.6)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = "rgba(232,220,200,0.35)";
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Lens panel */}
        <div style={{ position: "relative", minHeight: 320 }}>
          <LensPanel key={lens} lens={lens} />
        </div>
      </div>
    </section>
  );
}

function LensPanel({ lens }: { lens: Lens }) {
  return (
    <div
      style={{
        padding: "8px 2px 24px",
        animation: "axiom-lens-in 420ms cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      <style>{`
        @keyframes axiom-lens-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {lens === "storyteller" && <StorytellerView />}
      {lens === "designer" && <DesignerView />}
      {lens === "builder" && <BuilderView />}
    </div>
  );
}

function StorytellerView() {
  const steps = ["Interview Jane Jacobs.", "Edit the “Density” segment.", "Publish to Spotify."];
  return (
    <div>
      <p style={{ ...mono, fontSize: "0.7rem", letterSpacing: "0.14em", color: "rgba(232,220,200,0.35)", textTransform: "uppercase", marginBottom: 18 }}>
        // S1·E1 — opening arc
      </p>
      <h3 style={{ ...serif, fontWeight: 400, fontSize: "1.9rem", lineHeight: 1.2, color: "#e8dcc8", margin: "0 0 18px", letterSpacing: "-0.005em" }}>
        The Sound of Density.
      </h3>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {steps.map((step, i) => (
          <li
            key={step}
            style={{
              ...serif,
              fontSize: "1.25rem",
              lineHeight: 1.5,
              color: "#e8dcc8",
              padding: "10px 0 10px 40px",
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 14,
                width: 24,
                height: 24,
                borderRadius: "50%",
                border: "1px solid rgba(212,175,55,0.55)",
                color: "#D4AF37",
                ...mono,
                fontSize: "0.7rem",
                display: "grid",
                placeItems: "center",
              }}
            >
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DesignerView() {
  return (
    <div>
      <svg viewBox="0 0 340 240" style={{ width: "100%", height: "auto", display: "block", marginBottom: 14 }} aria-hidden="true">
        <defs>
          <radialGradient id="lens-hub" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(212,175,55,0.35)" />
            <stop offset="100%" stopColor="rgba(212,175,55,0)" />
          </radialGradient>
        </defs>
        <g stroke="rgba(95,169,161,0.45)" strokeWidth="0.8" fill="none">
          <path d="M170 120 L70 60" />
          <path d="M170 120 L270 60" />
          <path d="M170 120 L70 200" />
          <path d="M170 120 L270 200" />
          <path d="M170 120 L320 130" />
        </g>
        <circle cx="170" cy="120" r="44" fill="url(#lens-hub)" />
        <circle cx="170" cy="120" r="32" fill="rgba(13,11,9,0.6)" stroke="rgba(212,175,55,0.6)" strokeWidth="1" />
        <text x="170" y="117" textAnchor="middle" fontFamily="Cormorant Garamond" fontStyle="italic" fontSize="13" fill="#D4AF37">City</text>
        <text x="170" y="132" textAnchor="middle" fontFamily="Cormorant Garamond" fontStyle="italic" fontSize="13" fill="#D4AF37">Hub</text>
        <g fontFamily="IBM Plex Mono" fontSize="8.5" fill="rgba(232,228,218,0.7)">
          <g>
            <circle cx="70" cy="60" r="22" fill="rgba(13,11,9,0.7)" stroke="rgba(232,228,218,0.18)" />
            <text x="70" y="58" textAnchor="middle">Guest</text>
            <text x="70" y="68" textAnchor="middle">List</text>
          </g>
          <g>
            <circle cx="270" cy="60" r="22" fill="rgba(13,11,9,0.7)" stroke="rgba(232,228,218,0.18)" />
            <text x="270" y="58" textAnchor="middle">Episode</text>
            <text x="270" y="68" textAnchor="middle">Flow</text>
          </g>
          <g>
            <circle cx="70" cy="200" r="22" fill="rgba(13,11,9,0.7)" stroke="rgba(232,228,218,0.18)" />
            <text x="70" y="198" textAnchor="middle">Topic</text>
            <text x="70" y="208" textAnchor="middle">Map</text>
          </g>
          <g>
            <circle cx="270" cy="200" r="22" fill="rgba(13,11,9,0.7)" stroke="rgba(232,228,218,0.18)" />
            <text x="270" y="198" textAnchor="middle">Auth</text>
            <text x="270" y="208" textAnchor="middle">Service</text>
          </g>
          <g>
            <circle cx="320" cy="130" r="16" fill="rgba(13,11,9,0.7)" stroke="rgba(232,228,218,0.18)" />
            <text x="320" y="133" textAnchor="middle">API</text>
          </g>
        </g>
      </svg>
      <p style={{ ...mono, fontSize: "0.7rem", letterSpacing: "0.14em", color: "rgba(232,220,200,0.4)", textTransform: "uppercase", textAlign: "center", margin: 0 }}>
        System shape — entities, edges, intent
      </p>
    </div>
  );
}

function BuilderView() {
  return (
    <div>
      <p style={{ ...mono, fontSize: "0.7rem", letterSpacing: "0.14em", color: "rgba(232,220,200,0.35)", textTransform: "uppercase", marginBottom: 14 }}>
        // schema · v0.1
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {[
          { name: "guests", rows: ["id : uuid", "name : text", "city : text"] },
          { name: "episodes", rows: ["id : uuid", "title : text", "guest_id : fk"] },
        ].map((t) => (
          <div key={t.name} style={{ border: "1px solid rgba(232,220,200,0.14)", borderRadius: 6, background: "rgba(255,255,255,0.015)", overflow: "hidden" }}>
            <div style={{ ...mono, fontSize: "0.7rem", letterSpacing: "0.14em", color: "#D4AF37", padding: "8px 10px", borderBottom: "1px solid rgba(232,220,200,0.1)", background: "rgba(212,175,55,0.04)" }}>
              {t.name}
            </div>
            {t.rows.map((r, i) => (
              <div key={i} style={{ ...mono, fontSize: "0.72rem", color: "rgba(232,220,200,0.6)", padding: "6px 10px", borderBottom: i < t.rows.length - 1 ? "1px solid rgba(232,220,200,0.08)" : "none" }}>
                {r}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p style={{ ...mono, fontSize: "0.7rem", color: "#5FA9A1", letterSpacing: "0.14em", textAlign: "center", margin: 0 }}>
        ↳ join on guest_id
      </p>
    </div>
  );
}


/* ──────────────────────────────────────────────────────────
   04 — STRUCTURAL OUTPUTS
   ────────────────────────────────────────────────────────── */
export function StructuralOutputs() {
  const { ref, visible } = useReveal(0.12);

  const items = [
    {
      idx: "01",
      eye: "Continuity Vector",
      h: "The through-line that survives any pivot.",
      p: "Direction outlasts the conversation that produced it.",
    },
    {
      idx: "02",
      eye: "Architectural Compass",
      h: "A system shape you can hand to anyone.",
      p: "Entities, edges, intent — visible, not implied.",
    },
    {
      idx: "03",
      eye: "Decision Ledger",
      h: "Every commitment, every override, kept honest.",
      p: "Decisions hold their weight long after the moment passes.",
    },
  ];

  return (
    <section ref={ref} className="relative z-10 py-28 md:py-40 px-6">
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 h-px transition-all duration-[1.2s] ease-out"
        style={{
          width: visible ? "80%" : "0%",
          background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)",
        }}
      />
      <div className="max-w-3xl mx-auto">
        <p
          className="uppercase tracking-[0.35em] mb-4 text-center"
          style={{
            ...mono,
            fontSize: "0.65rem",
            color: "#6b5f50",
            opacity: visible ? 1 : 0,
            transition: "opacity 700ms",
          }}
        >
          04 // Structural Outputs
        </p>
        <h2
          className="text-center mb-3"
          style={{
            ...serif,
            fontWeight: 400,
            fontSize: "clamp(1.8rem, 4.5vw, 3rem)",
            lineHeight: 1.15,
            color: "#e8dcc8",
            letterSpacing: "-0.01em",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(16px)",
            transition: "all 900ms ease-out",
          }}
        >
          What you leave with.
        </h2>
        <p
          className="text-center italic mb-12"
          style={{
            ...serif,
            fontSize: "clamp(0.95rem, 1.8vw, 1.05rem)",
            color: "rgba(232,220,200,0.55)",
            maxWidth: 360,
            margin: "0 auto 48px",
            lineHeight: 1.5,
            opacity: visible ? 1 : 0,
            transition: "opacity 900ms ease-out 200ms",
          }}
        >
          Three artifacts. Every conversation produces them.
        </p>

        <div>
          {items.map((it, i) => (
            <div
              key={it.idx}
              style={{
                position: "relative",
                padding: "32px 0",
                borderTop: i === 0 ? "none" : "1px solid rgba(232,220,200,0.08)",
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(20px)",
                transition: `all 800ms cubic-bezier(0.16,1,0.3,1) ${0.2 + i * 0.15}s`,
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  right: -4,
                  top: 18,
                  ...mono,
                  fontWeight: 700,
                  fontSize: "5rem",
                  lineHeight: 1,
                  color: "rgba(232,228,218,0.05)",
                  letterSpacing: "-0.02em",
                  pointerEvents: "none",
                }}
              >
                {it.idx}
              </div>
              <p style={{ ...mono, fontSize: "0.65rem", letterSpacing: "0.24em", color: "rgba(212,175,55,0.6)", textTransform: "uppercase", marginBottom: 10 }}>
                {it.eye}
              </p>
              <h3 style={{ ...serif, fontWeight: 400, fontSize: "clamp(1.3rem, 3vw, 1.6rem)", lineHeight: 1.2, color: "#e8dcc8", margin: "0 0 10px", letterSpacing: "-0.005em" }}>
                {it.h}
              </h3>
              <p style={{ ...serif, fontSize: "1rem", lineHeight: 1.55, color: "rgba(232,220,200,0.55)", margin: 0, maxWidth: 360 }}>
                {it.p}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────
   05 — PARCHMENT BEAT (quiet aside)
   ────────────────────────────────────────────────────────── */
export function ParchmentAside() {
  const { ref, visible } = useReveal(0.15);
  return (
    <section
      ref={ref}
      className="relative z-10 py-24 md:py-32 px-6"
      style={{ background: "#E8DFC9", color: "#2A2118" }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.06,
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        }}
      />
      <div className="relative max-w-2xl mx-auto">
        <p
          className="uppercase tracking-[0.35em] mb-6"
          style={{
            ...mono,
            fontSize: "0.65rem",
            color: "rgba(42,33,24,0.5)",
            opacity: visible ? 1 : 0,
            transition: "opacity 700ms",
          }}
        >
          05 // a quiet aside
        </p>
        <h2
          style={{
            ...serif,
            fontWeight: 400,
            fontSize: "clamp(2rem, 5vw, 3.2rem)",
            lineHeight: 1.15,
            color: "#2A2118",
            margin: "0 0 24px",
            letterSpacing: "-0.01em",
            maxWidth: 540,
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(16px)",
            transition: "all 900ms ease-out",
          }}
        >
          Axiom was never designed to manage tasks.
        </h2>
        <p
          style={{
            ...serif,
            fontSize: "clamp(1rem, 1.8vw, 1.15rem)",
            lineHeight: 1.6,
            color: "rgba(42,33,24,0.78)",
            margin: 0,
            maxWidth: 540,
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(12px)",
            transition: "all 900ms ease-out 200ms",
          }}
        >
          It was designed for the part that happens before tasks exist — when an idea
          is still finding its shape, and the wrong system would flatten it.
          Most tools wait for you to be sure. Axiom is for the time before you are.
        </p>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────
   06 — THE BRIDGE
   ────────────────────────────────────────────────────────── */
export function BridgeSection({ onEnter }: { onEnter: () => void }) {
  const { ref, visible } = useReveal(0.2);
  return (
    <section ref={ref} className="relative z-10 py-28 md:py-40 px-6 text-center">
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 h-px transition-all duration-[1.2s] ease-out"
        style={{
          width: visible ? "80%" : "0%",
          background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)",
        }}
      />
      <div className="max-w-2xl mx-auto">
        <p
          className="uppercase tracking-[0.35em] mb-5"
          style={{
            ...mono,
            fontSize: "0.65rem",
            color: "#6b5f50",
            opacity: visible ? 1 : 0,
            transition: "opacity 700ms",
          }}
        >
          06 // The Bridge
        </p>
        <h2
          style={{
            ...serif,
            fontWeight: 400,
            fontSize: "clamp(2rem, 5.5vw, 3.4rem)",
            lineHeight: 1.18,
            color: "#e8dcc8",
            letterSpacing: "-0.01em",
            margin: "0 0 18px",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(16px)",
            transition: "all 900ms ease-out",
          }}
        >
          Decide here.{" "}
          <span style={{ fontStyle: "italic", color: "#D4AF37", fontWeight: 500 }}>Build anywhere.</span>
        </h2>
        <p
          className="mx-auto italic"
          style={{
            ...serif,
            fontSize: "clamp(0.95rem, 1.6vw, 1.05rem)",
            color: "rgba(232,220,200,0.55)",
            maxWidth: 340,
            margin: "0 auto 36px",
            lineHeight: 1.55,
            opacity: visible ? 1 : 0,
            transition: "opacity 900ms ease-out 200ms",
          }}
        >
          What you commit in Axiom travels with you — into Lovable, Figma, your team,
          your next quiet hour.
        </p>
        <button
          onClick={onEnter}
          className="uppercase"
          style={{
            ...mono,
            fontSize: "0.78rem",
            fontWeight: 500,
            letterSpacing: "0.28em",
            color: "#e8dcc8",
            padding: "16px 32px",
            border: "1px solid rgba(212,175,55,0.55)",
            background: "transparent",
            cursor: "pointer",
            transition: "background 220ms, border-color 220ms",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(12px)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(212,175,55,0.07)";
            e.currentTarget.style.borderColor = "rgba(212,175,55,0.85)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "rgba(212,175,55,0.55)";
          }}
        >
          Enter Axiom →
        </button>
      </div>
    </section>
  );
}

