import { useState, useEffect } from "react";

export function LandingHeader({ onSignIn }: { onSignIn?: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [installEvent, setInstallEvent] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
    }
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const appUrl = typeof window !== "undefined" ? window.location.origin + "/" : "/";

  const handleInstall = async () => {
    if (installEvent) {
      await installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      if (outcome === "accepted") {
        setInstallEvent(null);
        setInstalled(true);
      }
    } else {
      window.location.href = appUrl;
    }
  };

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: scrolled ? "rgba(13,11,9,0.95)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(212,175,55,0.1)" : "none",
        transition: "all 300ms ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "56px",
        padding: "0 20px",
      }}
      className="landing-header"
    >
      {/* Left: Logo */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <img
          src="/favicon.svg"
          alt="Atlas"
          style={{
            width: 32,
            height: 32,
            borderRadius: "22%",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: "0.15em",
            color: "#D4AF37",
            marginLeft: 10,
            fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
          }}
        >
          ATLAS
        </span>
      </div>

      {/* Center nav — desktop only */}
      <nav className="landing-header-nav" style={{ display: "none", gap: 32, alignItems: "center" }}>
        {[
          { label: "How It Works", href: "#how-it-works" },
          { label: "Features", href: "#features" },
          { label: "For Builders", href: "#builders" },
        ].map((item) => (
          <a
            key={item.href}
            href={item.href}
            style={{
              fontSize: 12,
              color: "rgba(229,231,235,0.6)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              textDecoration: "none",
              transition: "color 200ms",
              fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#D4AF37")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(229,231,235,0.6)")}
          >
            {item.label}
          </a>
        ))}
      </nav>

      {/* Right — mobile */}
      <div className="landing-header-mobile-right" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={handleInstall}
          title={installed ? "Already installed" : "Install Atlas"}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "1px solid rgba(212,175,55,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: installed ? "rgba(212,175,55,0.4)" : "#D4AF37",
            fontSize: 16,
            background: "transparent",
            cursor: installed ? "default" : "pointer",
          }}
        >
          {installed ? "✓" : "↓"}
        </button>
        <button
          onClick={onSignIn}
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            border: "1px solid rgba(212,175,55,0.3)",
            color: "#D4AF37",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            background: "transparent",
            cursor: "pointer",
            transition: "background 200ms",
            marginLeft: 8,
            fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(212,175,55,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          Sign In
        </button>
      </div>

      {/* Right — desktop */}
      <div className="landing-header-desktop-right" style={{ display: "none", alignItems: "center" }}>
        <button
          onClick={onSignIn}
          style={{
            color: "#D4AF37",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            transition: "color 200ms",
            fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(212,175,55,0.8)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#D4AF37")}
        >
          Sign In
        </button>
        <button
          onClick={onSignIn}
          style={{
            padding: "8px 20px",
            borderRadius: 8,
            background: "#D4AF37",
            color: "#0D0B09",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.08em",
            border: "none",
            cursor: "pointer",
            marginLeft: 12,
            transition: "background 200ms",
            fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(212,175,55,0.9)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#D4AF37")}
        >
          Enter Atlas →
        </button>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .landing-header {
            height: 64px !important;
            padding: 0 40px !important;
          }
          .landing-header-nav {
            display: flex !important;
          }
          .landing-header-mobile-right {
            display: none !important;
          }
          .landing-header-desktop-right {
            display: flex !important;
          }
        }
      `}</style>
    </header>
  );
}
