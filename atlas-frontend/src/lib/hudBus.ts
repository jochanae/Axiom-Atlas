/**
 * Listening HUD event bus — frontend-only, in-memory pub/sub.
 *
 * Surfaces "what Atlas is hearing" inline with conversation flow:
 * intent classified, memory written, decision caught, attachment ingested,
 * navigation logged. Backend can later replace this by pushing events
 * onto the same bus from an SSE handler.
 */

import { useEffect, useState } from "react";

export type HudEventType =
  | "INTENT"
  | "MEMORY"
  | "DECISION"
  | "INGESTED"
  | "NAVIGATED"
  | "EXTRACTED"
  | "TENSION"
  | "PROJECT";

export interface HudEvent {
  id: string;
  type: HudEventType;
  payload: string;
  projectName?: string;
  /** ISO timestamp */
  at: string;
}

type Listener = (events: HudEvent[]) => void;

const MAX_EVENTS = 20;

let events: HudEvent[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(events);
}

export function pushHudEvent(type: HudEventType, payload: string, meta?: { projectName?: string }) {
  const ev: HudEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    payload,
    ...(meta?.projectName ? { projectName: meta.projectName } : {}),
    at: new Date().toISOString(),
  };
  events = [ev, ...events].slice(0, MAX_EVENTS);
  emit();
}

export function subscribeHud(listener: Listener): () => void {
  listeners.add(listener);
  listener(events);
  return () => {
    listeners.delete(listener);
  };
}

export function getHudEvents(): HudEvent[] {
  return events;
}

export function clearHudEvents() {
  events = [];
  emit();
}

export function setHudEvents(nextEvents: HudEvent[]) {
  events = nextEvents.slice(0, MAX_EVENTS);
  emit();
}

// ── Dock state ──────────────────────────────────────────────────────────────
// When `docked` is true the floating HUD pill collapses into a small chip
// rendered next to "Global Insight" in the header subheader.

let docked = false;
const dockListeners = new Set<(v: boolean) => void>();

export function setHudDocked(v: boolean) {
  if (docked === v) return;
  docked = v;
  for (const l of dockListeners) l(docked);
}

export function getHudDocked() {
  return docked;
}

export function useHudDocked(): boolean {
  const [v, setV] = useState(docked);
  useEffect(() => {
    const l = (next: boolean) => setV(next);
    dockListeners.add(l);
    return () => {
      dockListeners.delete(l);
    };
  }, []);
  return v;
}
