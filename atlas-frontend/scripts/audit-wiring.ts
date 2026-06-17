#!/usr/bin/env bun
/**
 * Audit workspace component wiring.
 *
 * Walks src/components/** (and src/hooks/**), counts how many other files
 * import each module, and flags orphans. Run with:
 *
 *   bun scripts/audit-wiring.ts
 *   bun scripts/audit-wiring.ts --json
 *   bun scripts/audit-wiring.ts --only-orphans
 */
import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative, resolve, sep } from "path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");

const SCAN_DIRS = ["components", "hooks", "lib"].map((d) => join(SRC, d));
const SEARCH_DIRS = [SRC]; // who imports from anywhere under src

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE_ALWAYS = new Set(["node_modules", ".git", "dist", "build"]);
const IGNORE_AS_TARGET = new Set(["ui"]); // shadcn — noisy, skip as scan target

function walk(dir: string, out: string[] = [], skipTargets = false): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (IGNORE_ALWAYS.has(name)) continue;
    if (skipTargets && IGNORE_AS_TARGET.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out, skipTargets);
    else {
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot) : "";
      if (CODE_EXT.has(ext)) out.push(full);
    }
  }
  return out;
}

const targets = SCAN_DIRS.flatMap((d) => walk(d, [], true));
const allFiles = SEARCH_DIRS.flatMap((d) => walk(d, [], false));

// Build a single concatenated corpus once for fast substring scan.
type FileBlob = { path: string; body: string };
const corpus: FileBlob[] = allFiles.map((p) => ({
  path: p,
  body: readFileSync(p, "utf8"),
}));

function importMatchers(file: string): RegExp[] {
  // Match any import/from/require that resolves to this file's basename
  // via @/ alias, relative path, or absolute. Covers .ts/.tsx/.js/.jsx and
  // the no-extension form.
  const rel = relative(SRC, file).replaceAll(sep, "/");
  const noExt = rel.replace(/\.(tsx?|jsx?)$/, "");
  const base = noExt.split("/").pop()!;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // (a) any import string ending in /<base> or /<base>.ext
  const tailRe = new RegExp(`["'][^"']*\\/${esc(base)}(?:\\.[tj]sx?)?["']`);
  // (b) bare alias: "@/<noExt>" exactly
  const aliasRe = new RegExp(`["']@\\/${esc(noExt)}(?:\\.[tj]sx?)?["']`);
  return [tailRe, aliasRe];
}


type Row = { file: string; importers: number; status: "wired" | "orphan" };
const rows: Row[] = [];

for (const file of targets) {
  const res = importMatchers(file);
  let count = 0;
  for (const f of corpus) {
    if (f.path === file) continue;
    if (res.some((re) => re.test(f.body))) count++;
  }
  rows.push({
    file: relative(ROOT, file),
    importers: count,
    status: count > 0 ? "wired" : "orphan",
  });
}

rows.sort((a, b) => (a.status === b.status ? a.file.localeCompare(b.file) : a.status === "orphan" ? -1 : 1));

const args = new Set(process.argv.slice(2));
const onlyOrphans = args.has("--only-orphans");
const asJson = args.has("--json");

const filtered = onlyOrphans ? rows.filter((r) => r.status === "orphan") : rows;

if (asJson) {
  console.log(JSON.stringify(filtered, null, 2));
} else {
  const orphanCount = rows.filter((r) => r.status === "orphan").length;
  console.log(`\nWiring audit — ${rows.length} modules scanned, ${orphanCount} orphans\n`);
  const w = Math.max(...filtered.map((r) => r.file.length), 20);
  console.log(`${"FILE".padEnd(w)}  IMPORTERS  STATUS`);
  console.log("-".repeat(w + 22));
  for (const r of filtered) {
    const tag = r.status === "orphan" ? "ORPHAN" : "wired";
    console.log(`${r.file.padEnd(w)}  ${String(r.importers).padStart(9)}  ${tag}`);
  }
  console.log("");
}
