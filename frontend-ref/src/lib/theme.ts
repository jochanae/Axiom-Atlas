import { useEffect, useState } from "react";

export type ThemeMode = "obsidian" | "parchment";

function readTheme(): ThemeMode {
  if (typeof document === "undefined") return "obsidian";
  return (document.documentElement.dataset.theme as ThemeMode) === "parchment"
    ? "parchment"
    : "obsidian";
}

export function useThemeMode(): ThemeMode {
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  useEffect(() => {
    const update = () => setTheme(readTheme());
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}
