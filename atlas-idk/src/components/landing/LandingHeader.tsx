import { useState, useEffect, type CSSProperties } from "react";

const smallUiText: CSSProperties = {
  fontFamily: "Inter, sans-serif",
  fontWeight: 300,
  textTransform: "uppercase",
  letterSpacing: "0.15em",
};

export function LandingHeader({ onSignIn }: { onSignIn?: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [installEvent, setInstallEvent] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallEvent(e); };
    window.addEventListener("beforeinstallprompt", handler);
    if (window.matchMedia("(display-mode: standalone)").matches) setInstalled(true);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (installEvent) {
      await installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      if (outcome === "accepted") { setInstallEvent(null); setInstalled(true); }
    } else {
      window.location.href = "/home";
    }
  };

  return (
    <header
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        background: scrolled ? "rgba(13,11,9,0.72)" : "transparent",
        backdropFilter: scrolled ? "blur(15px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(212,175,55,0.1)" : "none",
        transition: "background 400ms ease, backdrop-filter 400ms ease, border-color 400ms ease",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: "56px", padding: "0 20px",
      }}
      className="lp-header"
    >
      {/* Left: Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img src="/axiom-logo.svg" alt="Axiom" style={{ width: 32, height: 32, borderRadius: "22%", flexShrink: 0 }} />
        <span style={{
          ...smallUiText,
          fontSize: 14, color: "#D4AF37",
        }}>
          AXIOM
        </span>
      </div>

      {/* Center nav intentionally empty. */}
      <nav className="lp-header-nav" style={{ display: "none", gap: 32, alignItems: "center" }} />

      {/* Right — mobile */}
      <div className="lp-header-mobile-right" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={handleInstall} title={installed ? "Already installed" : "Install Axiom"} style={{
          width: 32, height: 32, borderRadius: "50%", border: "1px solid rgba(212,175,55,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: installed ? "rgba(212,175,55,0.4)" : "#D4AF37", fontSize: 16,
          background: "transparent", cursor: installed ? "default" : "pointer",
        }}>
          {installed ? "✓" : "↓"}
        </button>
        <button onClick={onSignIn} style={{
          ...smallUiText,
          padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(212,175,55,0.3)",
          color: "#D4AF37", fontSize: 11,
          background: "transparent", cursor: "pointer", transition: "background 200ms", marginLeft: 8,
        }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(212,175,55,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          Sign In
        </button>
      </div>

      {/* Right — desktop */}
      <div className="lp-header-desktop-right" style={{ display: "none", alignItems: "center" }}>
        <button onClick={onSignIn} style={{
          ...smallUiText,
          color: "#D4AF37", fontSize: 12,
          background: "transparent", border: "none", cursor: "pointer", transition: "color 200ms",
        }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(212,175,55,0.8)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#D4AF37")}
        >
          Sign In
        </button>
        <button onClick={onSignIn} style={{
          ...smallUiText,
          padding: "8px 20px", borderRadius: 8, background: "#D4AF37", color: "#0D0B09",
          fontSize: 12, border: "none",
          cursor: "pointer", marginLeft: 12, transition: "background 200ms",
        }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(212,175,55,0.9)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#D4AF37")}
        >
          Enter Axiom →
        </button>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .lp-header { height: 64px !important; padding: 0 40px !important; }
          .lp-header-nav { display: flex !important; }
          .lp-header-mobile-right { display: none !important; }
          .lp-header-desktop-right { display: flex !important; }
        }
      `}</style>
    </header>
  );
}
