/**
 * textPacer — decouples a streaming source (network tokens, or a full string)
 * from the visible reveal rate, so text glides at a human reading cadence
 * instead of "plopping" in network bursts.
 *
 * Design (matches mem://design/conversational-flow):
 *  - Baseline rate ~6ms per character (~165 chars/sec) — slightly slower than
 *    fast reading, so the eye stays just ahead of the cursor.
 *  - Punctuation pauses: +90ms after . ! ?  •  +40ms after , ; :  •  +180ms after \n\n.
 *  - Catch-up mode: if buffered backlog > 400 chars, halve the per-char delay.
 *  - requestAnimationFrame loop — synced to display refresh, no setInterval drift.
 *  - One setState per frame max (caller's onTick is called at most once per rAF tick).
 *
 * Lifecycle:
 *   const pacer = createTextPacer({ onTick, onDone });
 *   pacer.push("hello ");      // append more source text any time
 *   pacer.push("world");
 *   await pacer.finish();      // mark stream complete; resolves when fully drained
 *   pacer.abort();             // instantly flush everything and stop (e.g. on error)
 */

export interface TextPacerOptions {
  /** Called (at most once per rAF tick) with the currently-released substring. */
  onTick: (released: string) => void;
  /** Called once after the released text has caught up to the final target. */
  onDone?: () => void;
  /** Baseline ms per character (default 6). */
  rateMs?: number;
  /** Backlog threshold above which catch-up halves the delay (default 400). */
  catchupAt?: number;
}

export interface TextPacer {
  /** Append more source text. Safe to call many times during streaming. */
  push: (delta: string) => void;
  /** Replace the entire target (used on `done` events with a cleaned final string). */
  setTarget: (full: string) => void;
  /** Signal the source is complete. Returns a promise that resolves when fully revealed. */
  finish: () => Promise<void>;
  /** Stop rAF, flush all remaining text instantly, fire onDone. */
  abort: () => void;
  /** Current released length (for diagnostics). */
  released: () => number;
}

const PUNCT_PAUSE: Record<string, number> = {
  ".": 90, "!": 90, "?": 90,
  ",": 40, ";": 40, ":": 40,
};

export function createTextPacer(opts: TextPacerOptions): TextPacer {
  const baseRate = opts.rateMs ?? 6;
  const catchupAt = opts.catchupAt ?? 400;

  let target = "";
  let released = 0;
  let finished = false;
  let aborted = false;
  let rafId: number | null = null;
  let lastTickMs = 0;
  let punctHoldUntil = 0;
  let lastEmittedLen = -1;
  let donePromise: Promise<void> | null = null;
  let resolveDone: (() => void) | null = null;

  const emit = () => {
    if (released === lastEmittedLen) return;
    lastEmittedLen = released;
    try { opts.onTick(target.slice(0, released)); } catch { /* swallow */ }
  };

  const complete = () => {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    emit();
    try { opts.onDone?.(); } catch { /* swallow */ }
    resolveDone?.();
    resolveDone = null;
  };

  const loop = (now: number) => {
    rafId = null;
    if (aborted) return;

    if (lastTickMs === 0) lastTickMs = now;
    const elapsed = now - lastTickMs;
    lastTickMs = now;

    if (now < punctHoldUntil) {
      // still in a punctuation pause — just schedule next frame
      schedule();
      return;
    }

    const backlog = target.length - released;
    if (backlog <= 0) {
      if (finished) { complete(); return; }
      schedule();
      return;
    }

    // Catch-up: if backlog is big, double the rate.
    const effectiveRate = backlog > catchupAt ? baseRate / 2 : baseRate;
    let charsThisFrame = Math.max(1, Math.floor(elapsed / effectiveRate));
    // Hard cap so a long stall doesn't dump 5000 chars in one frame.
    if (charsThisFrame > 80) charsThisFrame = 80;

    // Walk forward char by char so we can honor punctuation pauses mid-frame.
    for (let i = 0; i < charsThisFrame && released < target.length; i++) {
      const ch = target[released];
      released++;
      // Paragraph break = bigger pause
      if (ch === "\n" && target[released] === "\n") {
        punctHoldUntil = now + 180;
        break;
      }
      const pause = PUNCT_PAUSE[ch];
      if (pause && /\s|$/.test(target[released] ?? " ")) {
        punctHoldUntil = now + pause;
        break;
      }
    }

    emit();

    if (released >= target.length && finished) { complete(); return; }
    schedule();
  };

  const schedule = () => {
    if (rafId !== null || aborted) return;
    if (typeof requestAnimationFrame === "undefined") {
      // SSR / non-browser — just flush
      released = target.length;
      complete();
      return;
    }
    rafId = requestAnimationFrame(loop);
  };

  return {
    push(delta: string) {
      if (aborted || !delta) return;
      target += delta;
      schedule();
    },
    setTarget(full: string) {
      if (aborted) return;
      target = full;
      if (released > target.length) released = target.length;
      schedule();
    },
    finish() {
      finished = true;
      if (!donePromise) {
        donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });
      }
      // If already caught up, complete on next tick.
      if (released >= target.length) {
        Promise.resolve().then(complete);
      } else {
        schedule();
      }
      return donePromise;
    },
    abort() {
      aborted = true;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      released = target.length;
      emit();
      try { opts.onDone?.(); } catch { /* swallow */ }
      resolveDone?.();
      resolveDone = null;
    },
    released() { return released; },
  };
}

/**
 * followScrollIfNearBottom — gentle auto-follow that doesn't fight the user.
 * Call after each pacer onTick (or on any new content). If the user is within
 * `threshold` px of the bottom, snap the container to the bottom instantly
 * (rAF-paced renders make instant jumps look smooth). If they've scrolled up,
 * leave them alone.
 */
export function followScrollIfNearBottom(
  container: HTMLElement | null | undefined,
  threshold = 120,
): void {
  if (!container) return;
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (distance <= threshold) {
    container.scrollTop = container.scrollHeight;
  }
}
