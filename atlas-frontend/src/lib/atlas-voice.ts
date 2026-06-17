// Atlas voice layer — greeting selection with category diversity,
// time-of-day weighting, micro-state awareness, anti-repeat, and
// optional name personalization (~35% of the time).
//
// Categories:
//   momentum    — actively building; many open projects
//   calm        — neutral / strategic / open canvas
//   cinematic   — sovereign, Axiom-flavored
//   night       — late hours, builder mode
//   soft        — welcome-back, human moments

export type VoiceCategory = "momentum" | "calm" | "cinematic" | "night" | "soft";

export interface VoiceContext {
  hour: number;                // 0-23
  projectCount: number;        // active projects
  hasHistory: boolean;         // prior conversations
  msSinceLastActive: number | null; // null = first visit this device
  name: string | null;         // first name, capitalized
}

interface Phrase {
  head: string;
  sub: string;
  /** Whether {name} appears in head — used to vary name usage */
  named?: boolean;
}

// {name} = first name with no trailing period. If absent, no name shown.
const POOLS: Record<VoiceCategory, Phrase[]> = {
  momentum: [
    { head: "Let's move something forward.", sub: "Pick a thread. We'll unravel it." },
    { head: "Ready to build?", sub: "What needs clarity right now?" },
    { head: "Back at it.", sub: "Let's tighten the blueprint." },
    { head: "Momentum looks good today.", sub: "Where are we applying pressure?" },
    { head: "Something worth building?", sub: "Talk it out." },
    { head: "Back at it, {name}.", sub: "Where are we applying pressure?", named: true },
  ],
  calm: [
    { head: "Take your time.", sub: "Big systems start small." },
    { head: "The board is clear.", sub: "What deserves attention today?" },
    { head: "Let's think this through.", sub: "Talk it out." },
    { head: "No rush.", sub: "Start where your mind is." },
    { head: "Take your time, {name}.", sub: "What's been circling in your head?", named: true },
    { head: "The board is clear, {name}.", sub: "What deserves attention today?", named: true },
  ],
  cinematic: [
    { head: "Axiom is online.", sub: "What are we architecting?" },
    { head: "Systems standing by.", sub: "Where does the vision go next?" },
    { head: "Workspace calibrated.", sub: "Let's map the next move." },
    { head: "Signal is clear.", sub: "Bring the idea into focus." },
    { head: "Workspace calibrated, {name}.", sub: "Let's map the next move.", named: true },
  ],
  night: [
    { head: "Late one tonight?", sub: "Some ideas arrive after dark." },
    { head: "Still building?", sub: "Let's untangle it." },
    { head: "Night shift mode.", sub: "What are we solving?" },
    { head: "The quiet hours are good for thinking.", sub: "Keep going. We'll figure it out." },
    { head: "Still building, {name}?", sub: "Let's untangle it.", named: true },
  ],
  soft: [
    { head: "Good to see you.", sub: "What's pulling your attention lately?" },
    { head: "Welcome back.", sub: "What are we exploring today?" },
    { head: "There you are.", sub: "What's the current obsession?" },
    { head: "You've got the floor.", sub: "What's taking shape?" },
    { head: "Welcome back, {name}.", sub: "What are we exploring today?", named: true },
    { head: "Good to see you, {name}.", sub: "What's pulling your attention lately?", named: true },
  ],
};

const RECENT_KEY = "atlas-voice-recent";
const RECENT_MAX = 6;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(-RECENT_MAX) : [];
  } catch { return []; }
}

function pushRecent(key: string) {
  try {
    const next = [...loadRecent(), key].slice(-RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

/** Weighted category pick based on micro-state. */
function pickCategory(ctx: VoiceContext): VoiceCategory {
  const { hour, projectCount, hasHistory, msSinceLastActive } = ctx;
  const w: Record<VoiceCategory, number> = { momentum: 1, calm: 2, cinematic: 1, night: 0, soft: 1 };

  // Late night dominates
  if (hour >= 22 || hour < 5) { w.night += 6; w.cinematic += 1; w.calm = 0; w.momentum = 0; w.soft = 0; }
  // Evening leans cinematic + night-lite
  else if (hour >= 20) { w.night += 2; w.cinematic += 2; }
  // Morning leans soft + momentum
  else if (hour >= 5 && hour < 11) { w.soft += 2; w.momentum += 1; }
  // Afternoon leans momentum + cinematic
  else if (hour >= 11 && hour < 17) { w.momentum += 2; w.cinematic += 1; }

  // Micro-state
  if (projectCount >= 3) w.momentum += 2;
  if (projectCount === 0) { w.calm += 2; w.cinematic += 1; w.momentum = 0; }
  if (!hasHistory) { w.soft = Math.max(0, w.soft - 1); w.calm += 1; }

  // Returning after a gap
  if (msSinceLastActive !== null) {
    const hrs = msSinceLastActive / 3_600_000;
    if (hrs >= 24) w.soft += 4;       // "been a minute"
    else if (hrs >= 4) w.soft += 2;   // "welcome back"
  } else {
    // First visit ever — calm canvas
    w.calm += 2;
  }

  const entries = (Object.entries(w) as [VoiceCategory, number][]).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  let r = Math.random() * total;
  for (const [cat, n] of entries) { r -= n; if (r <= 0) return cat; }
  return "calm";
}

export interface ResolvedVoice {
  head: string;
  sub: string;
  category: VoiceCategory;
}

export function chooseGreeting(ctx: VoiceContext): ResolvedVoice {
  const recent = new Set(loadRecent());

  // Try a few categories before falling back, to avoid recent repeats
  let category = pickCategory(ctx);
  let pool = POOLS[category].filter(p => !recent.has(`${category}:${p.head}`));
  for (let i = 0; i < 3 && pool.length === 0; i++) {
    category = pickCategory(ctx);
    pool = POOLS[category].filter(p => !recent.has(`${category}:${p.head}`));
  }
  if (pool.length === 0) pool = POOLS[category];

  // Name usage: ~35%. If no name available, force unnamed.
  const wantNamed = !!ctx.name && Math.random() < 0.35;
  let candidates = pool.filter(p => !!p.named === wantNamed);
  if (candidates.length === 0) candidates = pool;

  const choice = candidates[Math.floor(Math.random() * candidates.length)];
  pushRecent(`${category}:${choice.head}`);

  const name = ctx.name ?? "there";
  return {
    head: choice.head.replace("{name}", name),
    sub: choice.sub.replace("{name}", name),
    category,
  };
}

const LAST_ACTIVE_KEY = "atlas-last-active-ms";

export function readLastActive(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

export function markActiveNow() {
  try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())); } catch {}
}
