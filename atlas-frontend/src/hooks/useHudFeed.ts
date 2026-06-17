import { useEffect, useState } from "react";
import { subscribeHud, type HudEvent } from "@/lib/hudBus";

export function useHudFeed(): HudEvent[] {
  const [events, setEvents] = useState<HudEvent[]>([]);
  useEffect(() => subscribeHud(setEvents), []);
  return events;
}
