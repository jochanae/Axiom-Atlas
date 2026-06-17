import { useState, useEffect } from "react";

function useForceDesktop() {
  const [force, setForce] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get("desktop") === "1" || p.get("view") === "desktop";
    } catch { return false; }
  });
  useEffect(() => {
    const handler = () => {
      try {
        const p = new URLSearchParams(window.location.search);
        setForce(p.get("desktop") === "1" || p.get("view") === "desktop");
      } catch {}
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  return force;
}

function useIsMobile() {
  const forceDesktop = useForceDesktop();
  // Mobile = stacked single-column. Tablet (>=768) and desktop (>=1024) are side-by-side.
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile && !forceDesktop;
}

function useIsTinyScreen() {
  const forceDesktop = useForceDesktop();
  const [tiny, setTiny] = useState(() => window.innerWidth < 420);
  useEffect(() => {
    const handler = () => setTiny(window.innerWidth < 420);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return tiny && !forceDesktop;
}

// Desktop breakpoint — used to guarantee the mobile bottom-nav never appears
// on screens >= 1024px, independent of useIsMobile's narrower threshold.
function useIsDesktop() {
  const forceDesktop = useForceDesktop();
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);
  useEffect(() => {
    const handler = () => setDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return desktop || forceDesktop;
}

export { useForceDesktop, useIsMobile, useIsTinyScreen, useIsDesktop };
