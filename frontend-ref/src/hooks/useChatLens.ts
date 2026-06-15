import { useState, useRef } from "react";

export type WorkspaceLens = "flow" | "build" | "look" | "scenario";

export function useChatLens(projectId: number | string | undefined) {
  const [wsModel, setWsModelRaw] = useState<string>(() => {
    try {
      const stored = localStorage.getItem("atlas-ws-model");
      if (stored) return stored;
      const r = localStorage.getItem("atlas-home-context");
      return r ? (JSON.parse(r).model ?? "multi") : "multi";
    } catch {
      return "multi";
    }
  });
  const setWsModel = (m: string) => {
    setWsModelRaw(m);
    try { localStorage.setItem("atlas-ws-model", m); } catch {}
  };
  const [wsLens, setWsLensRaw] = useState<WorkspaceLens>(() => {
    try {
      return (localStorage.getItem(`atlas-ws-lens-v2-${projectId}`) as WorkspaceLens) || "flow";
    } catch {
      return "flow";
    }
  });
  const [showLensPicker, setShowLensPicker] = useState(false);
  const [detectedLens, setDetectedLens] = useState<WorkspaceLens | null>(null);
  const scenarioStartIdxRef = useRef<number>(-1);
  const [showScenarioPrompt, setShowScenarioPrompt] = useState(false);
  const sendCtxRef = useRef({ wsLens: "flow" as WorkspaceLens, wsModel: "claude", githubToken: null as string | null });
  const [pendingLensSwitch, setPendingLensSwitch] = useState<WorkspaceLens | null>(null);
  const [scenarioBuffer, setScenarioBuffer] = useState<Array<{ role: string; content: string }>>([]);
  const [showWsModelSheet, setShowWsModelSheet] = useState(false);

  return {
    wsModel,
    setWsModel,
    wsLens,
    setWsLensRaw,
    showLensPicker,
    setShowLensPicker,
    detectedLens,
    setDetectedLens,
    showScenarioPrompt,
    setShowScenarioPrompt,
    pendingLensSwitch,
    setPendingLensSwitch,
    scenarioBuffer,
    setScenarioBuffer,
    showWsModelSheet,
    setShowWsModelSheet,
    sendCtxRef,
    scenarioStartIdxRef,
  };
}
