// Shiki highlighter — lazy singleton, VS Code-grade token coloring.
// Returns per-line token arrays so the DiffViewer can wrap each line with
// its own background tint (green/red) while keeping accurate syntax colors.

import type { HighlighterCore, ThemedToken } from "shiki/core";
import { bundledLanguages } from "shiki/langs";
import { bundledThemes } from "shiki/themes";

export type ShikiLang =
  | "tsx" | "ts" | "jsx" | "js"
  | "css" | "scss" | "html" | "json" | "md" | "bash" | "sh" | "yaml" | "sql"
  | "txt";

const SUPPORTED: ShikiLang[] = ["tsx", "ts", "jsx", "js", "css", "scss", "html", "json", "md", "bash", "sh", "yaml", "sql"];
const THEME = "github-dark-dimmed";

let highlighterPromise: Promise<HighlighterCore> | null = null;

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = (async () => {
    const { createHighlighterCore } = await import("shiki/core");
    const { createOnigurumaEngine } = await import("shiki/engine/oniguruma");
    return createHighlighterCore({
      themes: [bundledThemes[THEME]()],
      langs: [
        bundledLanguages.tsx(),
        bundledLanguages.typescript(),
        bundledLanguages.jsx(),
        bundledLanguages.javascript(),
        bundledLanguages.css(),
        bundledLanguages.scss(),
        bundledLanguages.html(),
        bundledLanguages.json(),
        bundledLanguages.markdown(),
        bundledLanguages.bash(),
        bundledLanguages.yaml(),
        bundledLanguages.sql(),
      ],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    });
  })();
  return highlighterPromise;
}

export function langFromFilename(filename?: string): ShikiLang {
  if (!filename) return "txt";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, ShikiLang> = {
    tsx: "tsx", ts: "ts", jsx: "jsx", js: "js", mjs: "js", cjs: "js",
    css: "css", scss: "scss", html: "html", htm: "html",
    json: "json", md: "md", mdx: "md",
    sh: "bash", bash: "bash", zsh: "bash",
    yml: "yaml", yaml: "yaml", sql: "sql",
  };
  return map[ext] ?? "txt";
}

export type HighlightedLine = ThemedToken[];

/**
 * Tokenize source into per-line arrays of themed tokens.
 * Returns null if the language is unsupported — caller renders plain text.
 */
export async function tokenizeLines(
  source: string,
  lang: ShikiLang,
): Promise<HighlightedLine[] | null> {
  if (lang === "txt" || !SUPPORTED.includes(lang)) return null;
  try {
    const hl = await getHighlighter();
    const { tokens } = hl.codeToTokens(source, { lang, theme: THEME });
    return tokens as HighlightedLine[];
  } catch {
    return null;
  }
}
