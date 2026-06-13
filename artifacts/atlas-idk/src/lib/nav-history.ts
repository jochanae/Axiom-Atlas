// Lightweight referrer stack — captures the user's navigation path so back
// buttons can return to the actual entry point rather than a hard-coded parent.
// Backed by sessionStorage; capped at 20 entries.

const KEY = "atlas-nav-stack";
const MAX = 20;

function read(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(stack: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX)));
  } catch {}
}

/** Push current path onto the stack (dedupes consecutive duplicates). */
export function pushNav(path: string) {
  const stack = read();
  if (stack[stack.length - 1] === path) return;
  stack.push(path);
  write(stack);
}

/** Return the previous entry (the one before current), without mutating. */
export function peekPrev(): string | null {
  const stack = read();
  return stack.length >= 2 ? stack[stack.length - 2] : null;
}

/** Pop current + return the previous entry (for back navigation). */
export function popPrev(): string | null {
  const stack = read();
  stack.pop(); // current
  const prev = stack.pop() ?? null;
  write(stack);
  return prev;
}

export function clearNav() {
  try { sessionStorage.removeItem(KEY); } catch {}
}
