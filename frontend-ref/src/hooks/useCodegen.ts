// useCodegen — frontend bridge to the native `POST /api/codegen` endpoint on
// our Cloud Run + Neon backend. Authenticates via the `atlas-session` cookie.
//
// Because the endpoint is request/response (not SSE), we synthesise progress
// steps locally and feed them into the existing LiveGenerationCard.

import { useCallback, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";

export type CodegenMode = "plan" | "blueprint" | "edit" | "thinking";

export interface CodegenFile {
  id?: number;
  filename: string;
  language: string;
  content: string;
  description?: string;
}

export interface UseCodegenOptions {
  projectId: number;
  sessionId?: number | null;
  onResult?: (file: CodegenFile) => void;
  onError?: (message: string) => void;
}

export interface UseCodegenReturn {
  running: boolean;
  steps: string[];
  mode: CodegenMode;
  lastFile: CodegenFile | null;
  run: (prompt: string, context?: string) => Promise<CodegenFile | null>;
  reset: () => void;
}

const STAGES: { label: string; delayMs: number }[] = [
  { label: "Loading project compass...", delayMs: 0 },
  { label: "Composing system prompt...", delayMs: 350 },
  { label: "Calling code model...", delayMs: 700 },
  { label: "Compiling sandbox preview...", delayMs: 2200 },
];

export function useCodegen(opts: UseCodegenOptions): UseCodegenReturn {
  const { projectId, sessionId, onResult, onError } = opts;
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [mode, setMode] = useState<CodegenMode>("thinking");
  const [lastFile, setLastFile] = useState<CodegenFile | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setRunning(false);
    setSteps([]);
    setMode("thinking");
  }, [clearTimers]);

  const run = useCallback(
    async (prompt: string, context?: string): Promise<CodegenFile | null> => {
      if (!prompt?.trim()) return null;
      clearTimers();
      setRunning(true);
      setMode("blueprint");
      setSteps([]);

      // Synthesised step stream while the request is in flight.
      STAGES.forEach((stage) => {
        const id = window.setTimeout(() => {
          setSteps((prev) => (prev.includes(stage.label) ? prev : [...prev, stage.label]));
        }, stage.delayMs);
        timersRef.current.push(id);
      });

      try {
        const res = await fetch(apiUrl("/api/codegen"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            sessionId: sessionId ?? null,
            prompt,
            context: context ?? null,
            model: "claude-sonnet-4-6",
          }),
        });

        clearTimers();

        if (!res.ok) {
          const errData = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errData?.error ?? `Codegen ${res.status}: ${res.statusText}`);
        }
        const data = await res.json().catch(() => null);
        const file = (data?.file ?? null) as CodegenFile | null;
        if (!file?.content) throw new Error("Codegen returned no content");

        setSteps((prev) => [...prev, `Generated ${file.filename}`, "Handing off to preview..."]);
        setLastFile(file);
        // brief tail so the user sees the success line
        const tail = window.setTimeout(() => setRunning(false), 600);
        timersRef.current.push(tail);
        onResult?.(file);
        return file;
      } catch (e) {
        clearTimers();
        const msg = e instanceof Error ? e.message : "Codegen failed";
        setSteps((prev) => [...prev, `Error: ${msg}`]);
        const tail = window.setTimeout(() => setRunning(false), 1200);
        timersRef.current.push(tail);
        onError?.(msg);
        return null;
      }
    },
    [projectId, sessionId, onResult, onError, clearTimers]
  );

  return { running, steps, mode, lastFile, run, reset };
}
