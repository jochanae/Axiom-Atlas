import { useEffect, useState } from "react";

/**
 * useDockVisibility
 *
 * Global, zero-wiring visibility controller for the bottom UnifiedContextDock.
 *
 * Hide triggers:
 *   1. Scroll-driven slide — scrolling down > THRESH hides; any scroll up reveals.
 *      Uses capture-phase window scroll listener so it catches scrolls inside
 *      nested scroll containers (chat feeds, panels) without explicit wiring.
 *   2. Input/voice focus — any textarea, [contenteditable], or [data-atlas-composer]
 *      focus hides immediately. Blur restores to the scroll-derived state.
 *   3. Top-of-page guarantee — when the most recently scrolled element is at top
 *      (scrollTop <= TOP_EPS), dock is always visible.
 *
 * Crescent peek: when hidden, dock translates down by (height - PEEK_PX) so the
 * top of the gold "A" remains visible. peek() force-restores on tap.
 */

const SCROLL_THRESH = 8;
const TOP_EPS = 8;

type Listener = () => void;

let inputActive = false;
let scrollHidden = false;
let atTop = true;
let lastY = 0;
let lastTarget: EventTarget | null = null;

const listeners = new Set<Listener>();
let installed = false;

function compute(): boolean {
  if (inputActive) return false;
  if (atTop) return true;
  return !scrollHidden;
}

function emit() {
  listeners.forEach((l) => l());
}

function onScroll(e: Event) {
  const target = e.target as (HTMLElement | Document | null);
  if (!target) return;

  let y = 0;
  if (target === document || target === document.documentElement || target === document.body) {
    y = window.scrollY || document.documentElement.scrollTop || 0;
  } else if (target instanceof HTMLElement) {
    y = target.scrollTop;
  } else {
    return;
  }

  // Reset lastY when scroll source changes so we don't compare across containers.
  if (target !== lastTarget) {
    lastTarget = target;
    lastY = y;
    const nextAtTop = y <= TOP_EPS;
    if (nextAtTop !== atTop) {
      atTop = nextAtTop;
      emit();
    }
    return;
  }

  const dy = y - lastY;
  const nextAtTop = y <= TOP_EPS;
  let changed = false;

  if (nextAtTop !== atTop) {
    atTop = nextAtTop;
    changed = true;
  }

  if (Math.abs(dy) > 2) {
    if (dy > SCROLL_THRESH && !scrollHidden) {
      scrollHidden = true;
      changed = true;
    } else if (dy < 0 && scrollHidden) {
      scrollHidden = false;
      changed = true;
    }
    lastY = y;
  }

  if (changed) emit();
}

function isComposerTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  if (el.closest?.("[data-atlas-composer]")) return true;
  // Heuristic: input[type=text|search] inside a composer-ish container
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    if (type === "text" || type === "search") {
      return !!el.closest?.("[data-atlas-composer], form, .composer, .chat-composer");
    }
  }
  return false;
}

function onFocusIn(e: FocusEvent) {
  if (isComposerTarget(e.target)) {
    if (!inputActive) {
      inputActive = true;
      emit();
    }
  }
}

function onFocusOut(e: FocusEvent) {
  if (isComposerTarget(e.target)) {
    if (inputActive) {
      inputActive = false;
      emit();
    }
  }
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Capture phase so nested scroll containers are caught.
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("focusin", onFocusIn);
  window.addEventListener("focusout", onFocusOut);
}

export const dockVisibility = {
  peek() {
    let changed = false;
    if (scrollHidden) { scrollHidden = false; changed = true; }
    if (inputActive) { inputActive = false; changed = true; }
    if (changed) emit();
  },
  setInputActive(active: boolean) {
    if (active !== inputActive) {
      inputActive = active;
      emit();
    }
  },
};

export function useDockVisibility(): boolean {
  install();
  const [visible, setVisible] = useState<boolean>(compute);
  useEffect(() => {
    const listener = () => setVisible(compute());
    listeners.add(listener);
    listener();
    return () => { listeners.delete(listener); };
  }, []);
  return visible;
}
