import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { LandingHeader } from "@/components/landing/LandingHeader";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const handleEnter = () => {
    try { sessionStorage.setItem("atlas-from-landing", "1"); } catch {}
    setLocation("/home");
  };

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const prev = {
      htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow,
      rootOverflow: root?.style.overflow ?? "", htmlHeight: html.style.height,
      bodyHeight: body.style.height, rootHeight: root?.style.height ?? "",
    };
    html.style.overflow = "auto"; body.style.overflow = "auto";
    if (root) root.style.overflow = "auto";
    html.style.height = "auto"; body.style.height = "auto";
    if (root) root.style.height = "auto";
    return () => {
      html.style.overflow = prev.htmlOverflow; body.style.overflow = prev.bodyOverflow;
      if (root) root.style.overflow = prev.rootOverflow;
      html.style.height = prev.htmlHeight; body.style.height = prev.bodyHeight;
      if (root) root.style.height = prev.rootHeight;
    };
  }, []);

  return (
    <div className="relative w-full overflow-x-hidden" style={{ background: "#050505" }}>
      <LandingHeader onSignIn={handleEnter} />

      {/* Noise grain overlay */}
      <div className="fixed inset-0 z-[1] pointer-events-none opacity-[0.03]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundSize: "128px 128px",
      }} />

      {/* 1px gold architectural grid */}
      <div className="fixed inset-0 z-[2] pointer-events-none" style={{
        opacity: 0.06,
        backgroundImage: "linear-gradient(#D4AF37 1px, transparent 1px), linear-gradient(90deg, #D4AF37 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />

      {/* Purple ambient glow */}
      <div className="fixed inset-0 z-[3] pointer-events-none" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(88,28,135,0.25) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(88,28,135,0.15) 0%, transparent 60%)",
      }} />

      <HeroSection onEnter={handleEnter} />
      <InterrogationSection />
      <HandoffSection />
      <WallOfGoldSection onEnter={handleEnter} />
      <PricingSection onEnter={handleEnter} />
      <LandingFooter />
    </div>
  );
}

/* ─── Hero ─── */
function HeroSection({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6" style={{ paddingTop: 56 }}>
      <LogicCore />

      <div className="relative z-10 max-w-4xl text-center">
        <h1 className="leading-[0.92] mb-6" style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontWeight: 500,
          color: "#e8dcc8",
          fontSize: "clamp(2.5rem, 8vw, 7rem)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}>
          Build nothing
          <br />
          until it's{" "}
          <span style={{ fontStyle: "italic", color: "#D4AF37" }}>
            structurally
            <br />
            sound.
          </span>
        </h1>

        <p className="mb-3 tracking-[0.3em] uppercase" style={{
          fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
          fontSize: "clamp(0.6rem, 1.2vw, 0.75rem)",
          color: "#6b5f50",
        }}>
          Axiom // Spec_Mode + Build_Mode v1.0
        </p>

        {/* Mode pills */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.6rem",
            letterSpacing: "0.2em",
            color: "#D4AF37",
            border: "1px solid rgba(212,175,55,0.3)",
            padding: "4px 10px",
            textTransform: "uppercase",
          }}>Spec Mode</span>
          <span style={{ color: "#3d3529", fontSize: "0.7rem" }}>→</span>
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.6rem",
            letterSpacing: "0.2em",
            color: "rgba(212,175,55,0.5)",
            border: "1px solid rgba(212,175,55,0.15)",
            padding: "4px 10px",
            textTransform: "uppercase",
          }}>Build Mode</span>
        </div>

        <button
          onClick={onEnter}
          className="group relative uppercase transition-all duration-700"
          style={{
            fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
            fontSize: "clamp(0.7rem, 1.5vw, 0.85rem)",
            fontWeight: 600,
            letterSpacing: "0.3em",
            color: "#D4AF37",
            border: "1px solid rgba(212,175,55,0.45)",
            background: "transparent",
            width: "100%",
            maxWidth: 420,
            padding: "18px 24px",
            display: "block",
            margin: "0 auto",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(212,175,55,0.07)"; e.currentTarget.style.borderColor = "rgba(212,175,55,0.75)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(212,175,55,0.45)"; }}
        >
          Enter Axiom
        </button>
      </div>

      {/* Bottom-left system readout */}
      <div className="absolute bottom-8 left-8 hidden md:block" style={{
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        fontSize: "0.65rem", color: "#3d3529", letterSpacing: "0.15em", lineHeight: 1.8,
      }}>
        SYSTEM: AXIOM_01<br />
        ORIGIN: CLARITY_ENGINE<br />
        STATUS: FORCING_STRUCTURE
      </div>

      {/* Scroll hint */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-30">
        <div className="w-px h-8" style={{ background: "linear-gradient(to bottom, transparent, #D4AF37)" }} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.55rem", letterSpacing: "0.2em", color: "#D4AF37" }}>
          SCROLL
        </span>
      </div>
    </section>
  );
}

/* ─── Section 2: The Problem ─── */
function InterrogationSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.15 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const mono: CSSProperties = { fontFamily: "'IBM Plex Mono', 'Courier New', monospace" };
  const serif: CSSProperties = { fontFamily: "'Cormorant Garamond', Georgia, serif" };

  const stats = [
    { value: "62%", label: "of builds get re-scoped mid-sprint", delay: "0.15s" },
    { value: "3.2×", label: "longer to ship without a structural spec", delay: "0.35s" },
    { value: "$41K", label: "average do-over tax per failed feature", delay: "0.55s" },
  ];

  return (
    <section ref={sectionRef} className="relative z-10 py-28 md:py-40 px-6">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px transition-all duration-[1.2s] ease-out" style={{
        width: visible ? "80%" : "0%",
        background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)",
      }} />

      <div className="max-w-4xl mx-auto">
        <p className="uppercase tracking-[0.35em] mb-12 transition-all duration-700" style={{
          ...mono, fontSize: "0.65rem", color: "#6b5f50",
          opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(12px)",
        }}>
          02 // The_Interrogation
        </p>

        <h2 className="uppercase leading-[1.0] mb-8 transition-all duration-[0.9s] ease-out" style={{
          ...serif, fontWeight: 600, fontSize: "clamp(1.8rem, 5vw, 4rem)", letterSpacing: "0.03em", color: "#e8dcc8",
          opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(20px)",
        }}>
          How many times have you
          <br />
          <span style={{ color: "#D4AF37", fontStyle: "italic" }}>built the wrong thing?</span>
        </h2>

        <p className="leading-[1.8] mb-16 max-w-2xl transition-all duration-700 delay-200" style={{
          ...mono, fontSize: "clamp(0.75rem, 1.4vw, 0.9rem)", color: "#8a7e6e",
          opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(16px)",
        }}>
          You had the idea. You had the energy. You started building.
          <br /><br />
          Then three sprints in, someone asks a question you should have
          answered on day one. The architecture cracks. The scope shifts.
          The timeline doubles.
          <br /><br />
          That's the <span style={{ color: "#D4AF37" }}>do-over tax</span>.
          Axiom makes it much harder to fall into.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-10">
          {stats.map((stat) => (
            <div key={stat.value} className="relative p-6 transition-all duration-700 ease-out" style={{
              background: "rgba(212,175,55,0.03)", border: "1px solid rgba(212,175,55,0.12)",
              opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)",
              transitionDelay: stat.delay,
            }}>
              <div className="absolute top-0 left-0 w-3 h-px" style={{ background: "#D4AF37" }} />
              <div className="absolute top-0 left-0 h-3 w-px" style={{ background: "#D4AF37" }} />
              <div className="absolute bottom-0 right-0 w-3 h-px" style={{ background: "#D4AF37" }} />
              <div className="absolute bottom-0 right-0 h-3 w-px" style={{ background: "#D4AF37" }} />
              <p className="mb-2" style={{ ...mono, fontSize: "clamp(1.8rem, 3vw, 2.5rem)", fontWeight: 600, color: "#D4AF37", letterSpacing: "-0.02em" }}>
                {stat.value}
              </p>
              <p style={{ ...mono, fontSize: "0.7rem", color: "#6b5f50", letterSpacing: "0.05em", lineHeight: 1.5 }}>
                {stat.label}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6 transition-all duration-700" style={{
          ...mono, fontSize: "0.55rem", color: "#3d3529", letterSpacing: "0.08em",
          opacity: visible ? 0.6 : 0, transitionDelay: "0.8s",
        }}>
          * Based on industry research and aggregate builder estimates.
        </p>

        <p className="mt-16 text-center uppercase tracking-[0.25em] transition-all duration-700" style={{
          ...serif, fontSize: "clamp(1rem, 2.5vw, 1.5rem)", fontWeight: 500, color: "#e8dcc8",
          opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(12px)",
          transitionDelay: "0.7s",
        }}>
          Axiom makes that{" "}
          <span style={{ color: "#D4AF37", fontStyle: "italic" }}>a lot harder to do.</span>
        </p>
      </div>
    </section>
  );
}

/* ─── Section 3: The Handoff ─── */
function HandoffSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        setTimeout(() => setActiveStep(0), 300);
        setTimeout(() => setActiveStep(1), 1000);
        setTimeout(() => setActiveStep(2), 1700);
      }
    }, { threshold: 0.12 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const mono: CSSProperties = { fontFamily: "'IBM Plex Mono', 'Courier New', monospace" };
  const serif: CSSProperties = { fontFamily: "'Cormorant Garamond', Georgia, serif" };

  const steps = [
    {
      phase: "SPEC MODE",
      title: "Structure",
      description: "Three sprints interrogate every layer — auth, data, logic, UI. Axiom asks the questions you haven't thought to ask yet. The system map fills with gold as each decision resolves.",
      visual: "scatter",
      color: "#8a7e6e",
      goldAccent: false,
    },
    {
      phase: "THE HANDOFF",
      title: "The Bridge",
      description: "Tap → Build Mode. Your Technical Manifest flows into the workspace. Every resolved node becomes a committed decision in the ledger. Your workspace already knows everything you decided — before a single line is written.",
      visual: "funnel",
      color: "#D4AF37",
      goldAccent: true,
      hero: true,
    },
    {
      phase: "BUILD MODE",
      title: "Enforced",
      description: "Every decision you make gets tracked against the spec. The moment you contradict something you committed to, Axiom catches it — shows you exactly what you said, and asks you to explain yourself first.",
      visual: "grid",
      color: "#D4AF37",
      goldAccent: true,
    },
  ];

  return (
    <section ref={sectionRef} className="relative z-10 py-28 md:py-40 px-6">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px transition-all duration-[1.2s] ease-out" style={{
        width: visible ? "80%" : "0%",
        background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)",
      }} />

      <div className="max-w-5xl mx-auto">
        <p className="uppercase tracking-[0.35em] mb-6 transition-all duration-700" style={{
          ...mono, fontSize: "0.65rem", color: "#6b5f50",
          opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(12px)",
        }}>
          03 // Spec_it → Build_it → Ship_it
        </p>

        <h2 className="uppercase leading-[1.0] mb-6 transition-all duration-[0.9s] ease-out" style={{
          ...serif, fontWeight: 600, fontSize: "clamp(1.6rem, 4.5vw, 3.5rem)", letterSpacing: "0.03em", color: "#e8dcc8",
          opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(20px)",
        }}>
          Finish speccing. Walk in{" "}
          <span style={{ color: "#D4AF37", fontStyle: "italic" }}>ready.</span>
        </h2>

        <p className="mb-20 max-w-xl transition-all duration-700 delay-200" style={{
          ...mono, fontSize: "clamp(0.7rem, 1.2vw, 0.85rem)", color: "#6b5f50", lineHeight: 1.7,
          opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(12px)",
        }}>
          The handoff is the moment that changes everything. Your spec doesn't stay behind in a doc.
          It walks into the workspace with you — committed, permanent, enforced.
        </p>

        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-6 md:left-1/2 top-0 bottom-0 w-px transition-all duration-[2s] ease-out" style={{
            background: visible ? "linear-gradient(to bottom, #6b5f50, #D4AF37, #D4AF37)" : "transparent",
            opacity: visible ? 0.3 : 0, transform: "translateX(-50%)",
          }} />

          <div className="space-y-16 md:space-y-24">
            {steps.map((step, i) => {
              const isActive = activeStep >= i;
              const isRight = i % 2 === 1;

              return (
                <div
                  key={step.phase}
                  className={`relative flex flex-col md:flex-row items-start md:items-center gap-6 md:gap-12 transition-all duration-700 ease-out ${isRight ? "md:flex-row-reverse" : ""}`}
                  style={{ opacity: isActive ? 1 : 0, transform: isActive ? "translateY(0)" : "translateY(30px)" }}
                >
                  {/* Phase node */}
                  <div className="absolute left-6 md:left-1/2 w-3 h-3 rounded-full transition-all duration-500 z-10" style={{
                    background: isActive ? step.color : "#2a2520",
                    border: `1px solid ${isActive ? step.color : "#3d3529"}`,
                    transform: "translate(-50%, 0)",
                    boxShadow: isActive && step.goldAccent ? `0 0 12px ${step.color}40` : "none",
                  }} />

                  {/* Visual */}
                  <div className="flex-shrink-0 ml-14 md:ml-0 md:w-[45%] flex justify-center">
                    {(step as any).hero ? (
                      <HandoffVisual active={isActive} />
                    ) : (
                      <FlowVisual type={step.visual} active={isActive} />
                    )}
                  </div>

                  {/* Content */}
                  <div className="ml-14 md:ml-0 md:w-[45%]">
                    {/* Hero badge */}
                    {(step as any).hero && isActive && (
                      <div style={{
                        display: "inline-block", marginBottom: 8,
                        ...mono, fontSize: "0.55rem", letterSpacing: "0.25em",
                        color: "#0D0B09", background: "#D4AF37",
                        padding: "3px 8px", textTransform: "uppercase",
                      }}>
                        THE HANDOFF
                      </div>
                    )}
                    <p className="uppercase tracking-[0.3em] mb-2" style={{
                      ...mono, fontSize: "0.6rem",
                      color: step.goldAccent ? "#D4AF37" : "#6b5f50",
                    }}>
                      {!(step as any).hero && step.phase}
                    </p>
                    <h3 className="uppercase mb-3" style={{
                      ...serif, fontSize: "clamp(1.4rem, 3vw, 2.2rem)", fontWeight: 600,
                      color: step.goldAccent ? "#D4AF37" : "#e8dcc8", letterSpacing: "0.04em",
                    }}>
                      {step.title}
                    </h3>
                    <p style={{ ...mono, fontSize: "clamp(0.7rem, 1.1vw, 0.8rem)", color: "#8a7e6e", lineHeight: 1.7 }}>
                      {step.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Handoff Visual ─── */
function HandoffVisual({ active }: { active: boolean }) {
  const size = 140;
  const cx = size / 2;
  const cy = size / 2;

  // Three nodes on left, three nodes on right, all converging to center point
  const leftNodes = [
    { x: 15, y: 35 }, { x: 15, y: 70 }, { x: 15, y: 105 },
  ];
  const rightNodes = [
    { x: 125, y: 35 }, { x: 125, y: 70 }, { x: 125, y: 105 },
  ];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-28 h-28 md:w-36 md:h-36" style={{ opacity: active ? 0.8 : 0.1 }}>
      <defs>
        <radialGradient id="handoffGlow" cx="50%" cy="50%" r="40%">
          <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#D4AF37" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r="50" fill="url(#handoffGlow)" />

      {/* Lines from left nodes to center */}
      {leftNodes.map((n, i) => (
        <line key={`l${i}`} x1={n.x} y1={n.y} x2={cx} y2={cy}
          stroke="#6b5f50" strokeWidth="0.7"
          opacity={active ? 0.5 : 0.1}
          style={{ transition: `all 0.5s ease-out ${i * 0.1}s` }}
        />
      ))}

      {/* Lines from center to right nodes */}
      {rightNodes.map((n, i) => (
        <line key={`r${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y}
          stroke="#D4AF37" strokeWidth="0.7"
          opacity={active ? 0.6 : 0.1}
          style={{ transition: `all 0.5s ease-out ${0.3 + i * 0.1}s` }}
        />
      ))}

      {/* Left nodes (spec) */}
      {leftNodes.map((n, i) => (
        <circle key={`ln${i}`} cx={n.x} cy={n.y} r="3"
          fill="#3d3529" stroke="#6b5f50" strokeWidth="0.8"
          opacity={active ? 0.7 : 0.1}
          style={{ transition: `all 0.4s ease-out ${i * 0.08}s` }}
        />
      ))}

      {/* Center node (the handoff) */}
      <circle cx={cx} cy={cy} r="6" fill="#D4AF37"
        opacity={active ? 1 : 0.1}
        style={{ transition: "all 0.6s ease-out 0.2s", filter: active ? "drop-shadow(0 0 6px #D4AF3780)" : "none" }}
      />

      {/* Right nodes (ledger entries) */}
      {rightNodes.map((n, i) => (
        <circle key={`rn${i}`} cx={n.x} cy={n.y} r="3"
          fill="#D4AF37" stroke="#D4AF37" strokeWidth="0.8"
          opacity={active ? 0.7 : 0.1}
          style={{ transition: `all 0.4s ease-out ${0.5 + i * 0.1}s` }}
        />
      ))}

      {/* Arrow hint */}
      <text x={cx - 3} y={cy + 22}
        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 7, fill: "#D4AF37", opacity: active ? 0.5 : 0, transition: "opacity 0.6s 0.4s" }}
      >
        →
      </text>
    </svg>
  );
}

/* ─── Flow Visuals ─── */
function FlowVisual({ type, active }: { type: string; active: boolean }) {
  const size = 140;
  const cx = size / 2;
  const cy = size / 2;

  if (type === "scatter") {
    const dots = [
      { x: 20, y: 35 }, { x: 95, y: 18 }, { x: 55, y: 72 },
      { x: 110, y: 55 }, { x: 38, y: 105 }, { x: 82, y: 95 },
      { x: 15, y: 70 }, { x: 120, y: 110 }, { x: 60, y: 25 },
      { x: 100, y: 80 }, { x: 30, y: 60 }, { x: 75, y: 45 },
    ];
    return (
      <svg viewBox={`0 0 ${size} ${size}`} className="w-28 h-28 md:w-36 md:h-36" style={{ opacity: active ? 0.6 : 0.1 }}>
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={active ? 2.5 : 1} fill="#8a7e6e"
            style={{ transition: `all 0.5s ease-out ${i * 0.05}s`, opacity: active ? 0.6 : 0.2 }}
          />
        ))}
      </svg>
    );
  }

  if (type === "funnel") {
    return (
      <svg viewBox={`0 0 ${size} ${size}`} className="w-28 h-28 md:w-36 md:h-36" style={{ opacity: active ? 0.7 : 0.1 }}>
        <defs>
          <radialGradient id="funnelGlow2" cx="50%" cy="50%" r="40%">
            <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#D4AF37" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r="50" fill="url(#funnelGlow2)" />
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          return (
            <line key={angle}
              x1={cx + Math.cos(rad) * 65} y1={cy + Math.sin(rad) * 65}
              x2={cx + Math.cos(rad) * 8} y2={cy + Math.sin(rad) * 8}
              stroke="#D4AF37" strokeWidth="0.6" opacity={active ? 0.5 : 0.1}
              style={{ transition: "all 0.6s ease-out" }}
            />
          );
        })}
        <circle cx={cx} cy={cy} r="4" fill="#D4AF37" opacity={active ? 0.8 : 0.1} style={{ transition: "all 0.6s" }} />
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-28 h-28 md:w-36 md:h-36" style={{ opacity: active ? 0.7 : 0.1 }}>
      {Array.from({ length: 16 }).map((_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        return (
          <rect key={i} x={20 + col * 28} y={20 + row * 28} width="20" height="20"
            fill="none" stroke="#D4AF37" strokeWidth="0.6" opacity={active ? 0.5 : 0.1}
            style={{ transition: `all 0.4s ease-out ${i * 0.04}s` }}
          />
        );
      })}
      <line x1="30" y1="30" x2="58" y2="30" stroke="#D4AF37" strokeWidth="0.4" opacity={active ? 0.3 : 0} />
      <line x1="30" y1="30" x2="30" y2="58" stroke="#D4AF37" strokeWidth="0.4" opacity={active ? 0.3 : 0} />
      <line x1="86" y1="58" x2="114" y2="58" stroke="#D4AF37" strokeWidth="0.4" opacity={active ? 0.3 : 0} />
      <line x1="58" y1="86" x2="58" y2="114" stroke="#D4AF37" strokeWidth="0.4" opacity={active ? 0.3 : 0} />
    </svg>
  );
}

/* ─── Section 4: The Declaration ─── */
function WallOfGoldSection({ onEnter }: { onEnter: () => void }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.15 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const serif: CSSProperties = { fontFamily: "'Cormorant Garamond', Georgia, serif" };
  const mono: CSSProperties = { fontFamily: "'IBM Plex Mono', 'Courier New', monospace" };

  const principles = [
    "Every dependency mapped before a single line is written.",
    "Every assumption interrogated until it proves itself.",
    "Every contradiction caught before it becomes a problem.",
  ];

  return (
    <section ref={sectionRef} className="relative z-10">
      <div className="relative overflow-hidden py-24 md:py-36 px-6" style={{ background: "#D4AF37" }}>
        {/* Grain on gold */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.06]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: "128px 128px", mixBlendMode: "multiply",
        }} />
        {/* Dark grid on gold */}
        <div className="absolute inset-0 pointer-events-none" style={{
          opacity: 0.06,
          backgroundImage: "linear-gradient(#050505 1px, transparent 1px), linear-gradient(90deg, #050505 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />

        <div className="relative max-w-4xl mx-auto">
          <p className="uppercase tracking-[0.35em] mb-12 transition-all duration-700" style={{
            ...mono, fontSize: "0.65rem", color: "#050505",
            opacity: visible ? 0.5 : 0, transform: visible ? "translateY(0)" : "translateY(12px)",
          }}>
            04 // The_Declaration
          </p>

          <h2 className="uppercase leading-[0.95] mb-16 transition-all duration-[1s] ease-out" style={{
            ...serif, fontWeight: 600, fontSize: "clamp(2rem, 6vw, 5rem)", letterSpacing: "0.02em", color: "#050505",
            opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)",
          }}>
            This is not
            <br />a project
            <br />management tool.
          </h2>

          <p className="leading-[1.6] mb-16 max-w-2xl transition-all duration-700" style={{
            ...serif, fontWeight: 500, fontSize: "clamp(1.1rem, 2.5vw, 1.6rem)", color: "#050505",
            opacity: visible ? 0.85 : 0, transform: visible ? "translateY(0)" : "translateY(16px)",
            transitionDelay: "0.2s", fontStyle: "italic",
          }}>
            Axiom is thinking infrastructure. The spec that follows you
            into every build decision — and holds you accountable to it.
          </p>

          <div className="space-y-6 mb-20">
            {principles.map((p, i) => (
              <div key={i} className="flex items-start gap-4 transition-all duration-700 ease-out" style={{
                opacity: visible ? 1 : 0, transform: visible ? "translateX(0)" : "translateX(-20px)",
                transitionDelay: `${0.3 + i * 0.15}s`,
              }}>
                <span className="mt-[0.6em] flex-shrink-0 w-4 h-px" style={{ background: "#050505", opacity: 0.4 }} />
                <p style={{ ...mono, fontSize: "clamp(0.7rem, 1.3vw, 0.85rem)", color: "#050505", lineHeight: 1.7, letterSpacing: "0.02em" }}>
                  {p}
                </p>
              </div>
            ))}
          </div>

          <div className="text-center transition-all duration-700" style={{
            opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(16px)", transitionDelay: "0.7s",
          }}>
            <button
              onClick={onEnter}
              className="group relative px-12 py-5 uppercase tracking-[0.25em] transition-all duration-500"
              style={{ ...mono, fontSize: "0.75rem", fontWeight: 500, color: "#D4AF37", background: "#050505", border: "none" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a1a"; e.currentTarget.style.boxShadow = "0 0 40px rgba(5,5,5,0.4)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#050505"; e.currentTarget.style.boxShadow = "none"; }}
            >
              Enter Axiom
            </button>
            <p className="mt-6 uppercase tracking-[0.2em]" style={{ ...mono, fontSize: "0.6rem", color: "#050505", opacity: 0.4 }}>
              Spec it. Build it. Ship it.
            </p>
          </div>
        </div>
      </div>

    </section>
  );
}

/* ─── Pricing ─── */
function PricingSection({ onEnter }: { onEnter: () => void }) {
  const [visRef, setVisRef] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const mono: CSSProperties = { fontFamily: "'IBM Plex Mono', 'Courier New', monospace" };
  const serif: CSSProperties = { fontFamily: "'Cormorant Garamond', Georgia, serif" };

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisRef(true); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const tiers = [
    {
      name: "Free",
      priceLabel: "Free",
      sub: "Always",
      bullets: ["3 projects", "50 messages / month", "Decision Catch engine", "Decision Ledger"],
      cta: "Start free",
      highlight: false,
    },
    {
      name: "Pro",
      priceLabel: "$19",
      sub: "/ month",
      bullets: ["Unlimited projects", "Unlimited messages", "GitHub integration", "Session memory"],
      cta: "Get Pro",
      highlight: true,
    },
    {
      name: "Teams",
      priceLabel: "$49",
      sub: "/ month",
      bullets: ["Everything in Pro", "Team workspace", "Shared decision ledger", "Admin controls"],
      cta: "Talk to us",
      highlight: false,
    },
  ];

  return (
    <section
      id="pricing"
      ref={sectionRef}
      className="relative z-10 py-28 md:py-36 px-6"
    >
      {/* Top divider */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px transition-all duration-[1.2s] ease-out" style={{
        width: visRef ? "80%" : "0%",
        background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)",
      }} />

      <div className="max-w-4xl mx-auto">
        {/* Section label */}
        <p className="uppercase tracking-[0.35em] mb-8 transition-all duration-700" style={{
          ...mono, fontSize: "0.65rem", color: "#6b5f50",
          opacity: visRef ? 1 : 0, transform: visRef ? "translateY(0)" : "translateY(12px)",
        }}>
          05 // Pricing
        </p>

        {/* Headline */}
        <h2 className="uppercase leading-[1.0] mb-4 transition-all duration-[0.9s] ease-out" style={{
          ...serif, fontWeight: 600, fontSize: "clamp(1.8rem, 5vw, 4rem)", letterSpacing: "0.03em", color: "#e8dcc8",
          opacity: visRef ? 1 : 0, transform: visRef ? "translateY(0)" : "translateY(20px)",
        }}>
          Simple pricing.{" "}
          <span style={{ color: "#D4AF37", fontStyle: "italic" }}>No surprises.</span>
        </h2>
        <p className="mb-16 transition-all duration-700 delay-200" style={{
          ...mono, fontSize: "clamp(0.7rem, 1.2vw, 0.85rem)", color: "#6b5f50",
          opacity: visRef ? 1 : 0, transform: visRef ? "translateY(0)" : "translateY(12px)",
        }}>
          Start free. Upgrade when it earns its keep.
        </p>

        {/* Tier cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {tiers.map((tier, i) => (
            <LandingTierCard key={tier.name} tier={tier} mono={mono} serif={serif} onEnter={onEnter}
              visible={visRef} delay={`${0.1 + i * 0.15}s`} />
          ))}
        </div>

        {/* Fine print */}
        <p className="mt-8 text-center transition-all duration-700" style={{
          ...mono, fontSize: "0.55rem", color: "#3d3529", letterSpacing: "0.1em",
          opacity: visRef ? 0.7 : 0, transitionDelay: "0.6s",
        }}>
          All plans include end-to-end encryption · Cancel anytime
        </p>
      </div>
    </section>
  );
}

type LandingTier = { name: string; priceLabel: string; sub: string; bullets: string[]; cta: string; highlight: boolean };

function LandingTierCard({ tier, mono, serif, onEnter, visible, delay }: {
  tier: LandingTier; mono: CSSProperties; serif: CSSProperties;
  onEnter: () => void; visible: boolean; delay: string;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      className="relative flex flex-col transition-all duration-700 ease-out"
      style={{
        padding: "26px 22px 24px",
        background: tier.highlight ? "rgba(212,175,55,0.06)" : "rgba(5,5,5,0.6)",
        border: `1px solid ${tier.highlight
          ? hov ? "rgba(212,175,55,0.55)" : "rgba(212,175,55,0.28)"
          : hov ? "rgba(212,175,55,0.2)" : "rgba(212,175,55,0.08)"}`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transitionDelay: delay,
        transition: `opacity 0.7s ease-out ${delay}, transform 0.7s ease-out ${delay}, border-color 180ms ease, background 180ms ease`,
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {tier.highlight && (
        <div className="absolute" style={{
          top: -1, right: 18, background: "#D4AF37", color: "#050505",
          ...mono, fontSize: "0.55rem", fontWeight: 700, letterSpacing: "0.14em",
          textTransform: "uppercase", padding: "3px 9px",
        }}>
          Most popular
        </div>
      )}
      <p style={{ ...mono, fontSize: "0.6rem", letterSpacing: "0.22em", textTransform: "uppercase", color: tier.highlight ? "#D4AF37" : "#6b5f50", marginBottom: 16 }}>
        {tier.name}
      </p>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 20 }}>
        <span style={{ ...serif, fontSize: tier.priceLabel === "Free" ? "2rem" : "2.8rem", fontWeight: 600, color: "#e8dcc8", lineHeight: 1, letterSpacing: "-0.02em" }}>
          {tier.priceLabel}
        </span>
        <span style={{ ...mono, fontSize: "0.6rem", color: "#6b5f50", marginBottom: 6 }}>{tier.sub}</span>
      </div>
      <div style={{ height: 1, background: tier.highlight ? "rgba(212,175,55,0.2)" : "rgba(212,175,55,0.07)", marginBottom: 20 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 26, flex: 1 }}>
        {tier.bullets.map((b) => (
          <div key={b} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
            <span style={{
              width: 13, height: 13, flexShrink: 0, marginTop: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              border: `1px solid ${tier.highlight ? "rgba(212,175,55,0.35)" : "rgba(107,95,80,0.3)"}`,
              borderRadius: "50%",
            }}>
              <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
                <path d="M1.5 4L3.2 5.7L6.5 2.3" stroke={tier.highlight ? "#D4AF37" : "#6b5f50"} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span style={{ ...mono, fontSize: "0.7rem", color: "#8a7e6e", lineHeight: 1.5 }}>{b}</span>
          </div>
        ))}
      </div>
      <button onClick={onEnter} style={{
        padding: "10px 0", border: `1px solid ${tier.highlight ? "rgba(212,175,55,0.5)" : "rgba(107,95,80,0.25)"}`,
        background: tier.highlight ? hov ? "rgba(212,175,55,0.14)" : "rgba(212,175,55,0.06)" : hov ? "rgba(107,95,80,0.1)" : "transparent",
        color: tier.highlight ? "#D4AF37" : "#6b5f50", ...mono, fontSize: "0.65rem",
        letterSpacing: "0.2em", textTransform: "uppercase", cursor: "pointer", transition: "all 180ms ease",
        fontWeight: tier.highlight ? 600 : 400,
      }}>
        {tier.cta}
      </button>
    </div>
  );
}

/* ─── Footer ─── */
function LandingFooter() {
  const mono: CSSProperties = { fontFamily: "'IBM Plex Mono', 'Courier New', monospace" };
  return (
    <div className="py-10 px-6 flex flex-col items-center gap-3" style={{ background: "#050505" }}>
      <img src="/axiom-logo.svg" alt="Axiom" style={{ width: 28, height: 28, borderRadius: "20%", opacity: 0.6 }} />
      <p className="uppercase tracking-[0.4em]" style={{ ...mono, fontSize: "0.55rem", color: "#3d3529" }}>
        Axiom — by Into Innovations
      </p>
      <div className="w-6 h-px" style={{ background: "rgba(212,175,55,0.2)" }} />
      <p style={{ ...mono, fontSize: "0.5rem", color: "#2a2520", letterSpacing: "0.15em" }}>
        © {new Date().getFullYear()} Into Innovations LLC. All rights reserved.
      </p>
      <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginTop: "8px" }}>
        {[
          { label: "Terms", href: "/terms" },
          { label: "Privacy", href: "/privacy" },
          { label: "Help & FAQ", href: "/help" },
          { label: "Pricing", href: "#pricing" },
        ].map(({ label, href }) => (
          <a key={href} href={href} style={{ fontSize: "0.5rem", color: "#3a3530", letterSpacing: "0.1em", textDecoration: "underline" }}>{label}</a>
        ))}
      </div>
    </div>
  );
}

/* ─── Logic Core: Animated 3D wireframe cube ─── */
function LogicCore() {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    let frame: number;
    const animate = () => { setRotation((r) => (r + 0.15) % 360); frame = requestAnimationFrame(animate); };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  const size = 120; const cx = 200; const cy = 200;
  const rad = (rotation * Math.PI) / 180;
  const radY = (rotation * 0.7 * Math.PI) / 180;

  const project = (x: number, y: number, z: number) => {
    const x1 = x * Math.cos(radY) - z * Math.sin(radY);
    const z1 = x * Math.sin(radY) + z * Math.cos(radY);
    const y1 = y * Math.cos(rad * 0.3) - z1 * Math.sin(rad * 0.3);
    const z2 = y * Math.sin(rad * 0.3) + z1 * Math.cos(rad * 0.3);
    const scale = 400 / (400 + z2);
    return { x: cx + x1 * scale, y: cy + y1 * scale, opacity: 0.3 + 0.7 * scale };
  };

  const s = size;
  const vertices = [
    project(-s,-s,-s), project(s,-s,-s), project(s,s,-s), project(-s,s,-s),
    project(-s,-s,s), project(s,-s,s), project(s,s,s), project(-s,s,s),
  ];
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
      <svg viewBox="0 0 400 400" className="w-[280px] h-[280px] md:w-[420px] md:h-[420px] lg:w-[500px] lg:h-[500px]" style={{ opacity: 0.25 }}>
        <defs>
          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#D4AF37" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r="180" fill="url(#coreGlow)" />
        {edges.map(([a, b], i) => (
          <line key={i} x1={vertices[a].x} y1={vertices[a].y} x2={vertices[b].x} y2={vertices[b].y}
            stroke="#D4AF37" strokeWidth="0.8" opacity={Math.min(vertices[a].opacity, vertices[b].opacity)} />
        ))}
        {vertices.map((v, i) => (
          <circle key={i} cx={v.x} cy={v.y} r="2" fill="#D4AF37" opacity={v.opacity} />
        ))}
      </svg>
    </div>
  );
}
