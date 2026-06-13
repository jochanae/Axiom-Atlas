import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Session, Project } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { LandingHeader } from "@/components/landing/LandingHeader";
import {
  InterrogationFragments,
  StrategicManifest,
  StructuralOutputs,
  ParchmentAside,
  BridgeSection,
} from "@/components/landing/StrategicManifest";

const smallUiText: CSSProperties = {
  fontFamily: "Inter, sans-serif",
  fontWeight: 300,
  textTransform: "uppercase",
  letterSpacing: "0.15em",
};

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const handleEnter = () => {
    try { sessionStorage.setItem("atlas-from-landing", "1"); } catch {}
    setLocation("/login");
  };

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const prev = {
      htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow,
      rootOverflow: root?.style.overflow ?? "", htmlHeight: html.style.height,
      bodyHeight: body.style.height, rootHeight: root?.style.height ?? "",
      htmlOverscroll: html.style.overscrollBehaviorY, bodyOverscroll: body.style.overscrollBehaviorY,
    };
    html.style.overflow = "auto"; body.style.overflow = "auto";
    if (root) root.style.overflow = "auto";
    html.style.height = "auto"; body.style.height = "auto";
    if (root) root.style.height = "auto";
    html.style.overscrollBehaviorY = "auto"; body.style.overscrollBehaviorY = "auto";
    html.classList.add("atlas-landing-active");
    return () => {
      html.style.overflow = prev.htmlOverflow; body.style.overflow = prev.bodyOverflow;
      if (root) root.style.overflow = prev.rootOverflow;
      html.style.height = prev.htmlHeight; body.style.height = prev.bodyHeight;
      if (root) root.style.height = prev.rootHeight;
      html.style.overscrollBehaviorY = prev.htmlOverscroll;
      body.style.overscrollBehaviorY = prev.bodyOverscroll;
      html.classList.remove("atlas-landing-active");
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

      {/* 1px architectural grid — neutral, no warm tint */}
      <div className="fixed inset-0 z-[2] pointer-events-none" style={{
        opacity: 0.04,
        backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />

      {/* Purple ambient glow (subtle — avoids muddying the gold/dark mix) */}
      <div className="fixed inset-0 z-[3] pointer-events-none" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(88,28,135,0.10) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(88,28,135,0.06) 0%, transparent 60%)",
      }} />

      <HeroSection onEnter={handleEnter} />
      <InterrogationFragments />
      <StrategicManifest />
      <StructuralOutputs />
      <ParchmentAside />
      <BridgeSection onEnter={handleEnter} />
      <PricingSection onEnter={handleEnter} />
      <LandingFooter />
    </div>
  );
}

/* ─── Hero ─── */
function HeroSection({ onEnter }: { onEnter: () => void }) {
  const [btnOpacity, setBtnOpacity] = useState(1);
  const [btnScale, setBtnScale] = useState(1);

  useEffect(() => {
    const onScroll = () => {
      const progress = Math.min(window.scrollY / 340, 1);
      setBtnOpacity(1 - progress);
      setBtnScale(1 - progress * 0.05);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6" style={{ paddingTop: 56 }}>
      <LogicCore />

      <div className="relative z-10 max-w-4xl text-center">
        <p className="mb-8" style={{
          ...smallUiText,
          fontSize: "clamp(0.6rem, 1.2vw, 0.72rem)",
          color: "rgba(232,220,200,0.32)",
        }}>
          Axiom // From spark to decision
        </p>

        <h1 className="leading-[0.95] mb-8" style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontWeight: 400,
          color: "#e8dcc8",
          fontSize: "clamp(2.2rem, 7vw, 5.6rem)",
          letterSpacing: "-0.01em",
        }}>
          Every great reality
          <br />
          began as an idea that{" "}
          <span style={{ fontStyle: "italic", color: "#D4AF37", fontWeight: 500 }}>held its shape</span>.
        </h1>

      <p className="mb-10 italic mx-auto" style={{
        fontFamily: "'Cormorant Garamond', Georgia, serif",
        fontWeight: 400,
        color: "rgba(232,220,200,0.55)",
        fontSize: "clamp(1rem, 2vw, 1.25rem)",
        maxWidth: 480,
        lineHeight: 1.55,
      }}>
        A workspace where ideas hold their shape long enough to become real.
      </p>

        {/* Mode pills */}
        <div className="flex items-center justify-center gap-2 mb-12 flex-wrap">
          {["Think it through", "Map it out", "Bring it to life"].map((label) => (
            <span key={label} style={{
              ...smallUiText,
              fontSize: "0.62rem",
              color: "rgba(232,220,200,0.55)",
              border: "1px solid rgba(232,220,200,0.14)",
              padding: "6px 12px",
              borderRadius: 999,
            }}>
              {label}
            </span>
          ))}
        </div>

        <button
          onClick={onEnter}
          className="group relative"
          style={{
            ...smallUiText,
            fontSize: "clamp(0.7rem, 1.5vw, 0.8rem)",
            color: "#e8dcc8",
            border: "1px solid rgba(212,175,55,0.5)",
            background: "transparent",
            padding: "14px 32px",
            display: "inline-block",
            opacity: btnOpacity,
            transform: `scale(${btnScale})`,
            transition: "background 200ms, border-color 200ms",
            pointerEvents: btnOpacity < 0.05 ? "none" : "auto",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(212,175,55,0.07)";
            e.currentTarget.style.borderColor = "rgba(212,175,55,0.85)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "rgba(212,175,55,0.5)";
          }}
        >
          Enter Axiom →
        </button>

        {/* Scroll hint — sits below the button with breathing room */}
        <div
          className="mt-14 flex flex-col items-center gap-2"
          style={{ animation: "axiomScrollBob 2.4s ease-in-out infinite" }}
        >
          <div className="w-px h-8" style={{ background: "linear-gradient(to bottom, transparent, rgba(212,175,55,0.55))" }} />
          <span style={{ ...smallUiText, fontSize: "0.55rem", color: "rgba(212,175,55,0.55)" }}>
            SCROLL
          </span>
        </div>
      </div>
      <style>{`@keyframes axiomScrollBob { 0%,100% { transform: translateY(0); opacity: 0.4; } 50% { transform: translateY(6px); opacity: 0.7; } }`}</style>
    </section>
  );
}

/* ─── Pricing ─── */
function PricingSection({ onEnter }: { onEnter: () => void }) {
  const [visRef, setVisRef] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const mono: CSSProperties = smallUiText;
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
      bullets: ["1 project", "Unlimited AI calls", "Session-only vault", "Ledger history 24hrs"],
      cta: "Start free",
      highlight: false,
    },
    {
      name: "Pro",
      priceLabel: "$19",
      sub: "/ month",
      bullets: ["Unlimited projects", "Permanent vault", "Full ledger history", "GitHub integration", "Project profiles"],
      cta: "Get Pro",
      highlight: true,
    },
    {
      name: "Teams",
      priceLabel: "$49",
      sub: "/ seat / month",
      bullets: ["Everything in Pro", "Shared decision ledger", "Team member invites", "Collaborative sessions", "Admin controls"],
      cta: "Request access",
      highlight: false,
    },
  ];

  return (
    <section
      id="pricing"
      ref={sectionRef}
      className="relative z-10 py-28 md:py-36 px-6"
    >
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px transition-all duration-[1.2s] ease-out" style={{
        width: visRef ? "80%" : "0%",
        background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)",
      }} />

      <div className="max-w-4xl mx-auto">
        <p className="mb-6 text-center" style={{
          ...mono, fontSize: "0.65rem", color: "#6b5f50",
          opacity: visRef ? 1 : 0, transform: visRef ? "translateY(0)" : "translateY(12px)",
        }}>
          07 // Pricing
        </p>

        <h2 className="text-center mb-3" style={{
          ...serif, fontWeight: 400, fontSize: "clamp(1.7rem, 4vw, 2.6rem)", letterSpacing: "-0.01em", color: "#e8dcc8",
          opacity: visRef ? 1 : 0, transform: visRef ? "translateY(0)" : "translateY(16px)",
          transition: "all 900ms ease-out",
        }}>
          Simple pricing.{" "}
          <span style={{ color: "#D4AF37", fontStyle: "italic", fontWeight: 500 }}>No surprises.</span>
        </h2>
        <p className="mb-12 text-center italic" style={{
          ...serif, fontSize: "1rem", color: "rgba(232,220,200,0.55)",
          opacity: visRef ? 1 : 0, transition: "opacity 900ms ease-out 200ms",
        }}>
          Start free. Upgrade when it earns its keep.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {tiers.map((tier, i) => (
            <LandingTierCard key={tier.name} tier={tier} mono={mono} serif={serif} onEnter={onEnter}
              visible={visRef} delay={`${0.1 + i * 0.15}s`} />
          ))}
        </div>

        <p className="mt-8 text-center transition-all duration-700" style={{
          ...mono, fontSize: "0.55rem", color: "#3d3529",
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
          ...mono, fontSize: "0.55rem", padding: "3px 9px",
        }}>
          Most popular
        </div>
      )}
      <p style={{ ...mono, fontSize: "0.6rem", color: tier.highlight ? "#D4AF37" : "#6b5f50", marginBottom: 16 }}>
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
        cursor: "pointer", transition: "all 180ms ease",
      }}>
        {tier.cta}
      </button>
    </div>
  );
}

/* ─── Footer ─── */
function LandingFooter() {
  const mono: CSSProperties = smallUiText;
  return (
    <div className="py-10 px-6 flex flex-col items-center gap-3" style={{ background: "#050505" }}>
      <img src="/axiom-logo.svg" alt="Axiom" style={{ width: 28, height: 28, borderRadius: "20%", opacity: 0.6 }} />
      <p style={{ ...mono, fontSize: "0.55rem", color: "#3d3529" }}>
        Axiom — by Into Innovations
      </p>
      <div className="w-6 h-px" style={{ background: "rgba(212,175,55,0.2)" }} />
      <p style={{ ...mono, fontSize: "0.5rem", color: "#2a2520" }}>
        © {new Date().getFullYear()} Into Innovations LLC. All rights reserved.
      </p>
      <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginTop: "8px" }}>
        {[
          { label: "Terms", href: "/terms" },
          { label: "Privacy", href: "/privacy" },
          { label: "Help & FAQ", href: "/help" },
          { label: "Pricing", href: "#pricing" },
        ].map(({ label, href }) => (
          <a key={href} href={href} style={{ ...mono, fontSize: "0.5rem", color: "#3a3530", textDecoration: "underline" }}>{label}</a>
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
      <svg viewBox="0 0 400 400" className="w-[260px] h-[260px] md:w-[380px] md:h-[380px] lg:w-[460px] lg:h-[460px]" style={{ opacity: 0.22 }}>
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
