import { useState, useCallback, useRef, useEffect } from "react";
import { useAtlasStream } from "./useAtlasStream";
import { loadProfile, profileToString } from "@/lib/userProfile";
import { routeDirectImageRequestToSketchPrompt, shouldAutoRouteToSketchPrompt, SKETCH_PROMPT_MARKER_RE } from "@/lib/sketchStylePresets";

const STREAM_TIMEOUT_MS = 30_000;

export interface NexusMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  kind?: "genesis";
  genesisData?: { projectName: string; timestamp: string };
  imageUrl?: string;
  imageGen?: {
    images: Array<{
      imageUrl: string;
      prompt?: string;
      model?: string;
      mode?: "render" | "schematic" | string;
    }>;
  } | null;
  createdAt: string;
  streaming?: boolean;
  model?: string | null;
  intentType?: string | null;
  isNew?: boolean;
  handoffSignal?: NexusHandoffSignal | null;
  focusSuggestion?: NexusFocusSuggestion;
  surface?: string | null;
  executionTimeMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  runStatus?: string;
  runSummary?: string | null;
  runActions?: unknown[] | null;
  runArtifacts?: unknown[] | null;
  terminalCmd?: unknown;
  terminalResult?: unknown;
  modelUsed?: string | null;
  errorMessage?: string;
  plan?: unknown;
  visualImageBase64?: string | null;
  visualCaption?: string | null;
  visualLoading?: boolean;
}

export interface NexusHandoffSignal {
  projectName?: string | null;
  reason?: string | null;
  readyToHandoff?: boolean;
  confidence?: string;
}

export interface NexusFocusSuggestion {
  projectId: number;
  projectName: string;
}

export interface NexusShapingPayload {
  title: string;
  audience: string;
  tension: string;
  what: string;
}

export interface NexusLiveStep {
  id: string;
  verb: string;
  target?: string;
  detail?: string;
  status?: "ok" | "warn" | "fail";
}

export interface UseNexusChatStreamOptions {
  focusProjectId?: number | null;
  model?: string;
  mode?: string;
  conversationId?: string | null;
  projectContext?: {
    projectId: number;
    memorySummary?: string | null;
    decisions?: unknown[];
  } | null;
}

export interface UseNexusChatStreamReturn {
  messages: NexusMessage[];
  setMessages: React.Dispatch<React.SetStateAction<NexusMessage[]>>;
  isStreaming: boolean;
  isPending: boolean;
  liveStep: NexusLiveStep | null;
  liveSteps: NexusLiveStep[];
  shapingPayload: NexusShapingPayload | null;
  setShapingPayload: React.Dispatch<React.SetStateAction<NexusShapingPayload | null>>;
  shapingHeld: boolean;
  setShapingHeld: React.Dispatch<React.SetStateAction<boolean>>;
  handoffSignal: NexusHandoffSignal | null;
  send: (options: {
    text: string;
    imageBase64?: string;
    imageMimeType?: string;
    overrideOptions?: Partial<UseNexusChatStreamOptions>;
  }) => Promise<void>;
  abort: () => void;
  clearMessages: () => void;
}

export function useNexusChatStream(
  options: UseNexusChatStreamOptions
): UseNexusChatStreamReturn {
  const { focusProjectId, model = "claude", mode, conversationId, projectContext } = options;

  const [messages, setMessages] = useState<NexusMessage[]>([]);
  const messagesRef = useRef<NexusMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [liveStep, setLiveStep] = useState<NexusLiveStep | null>(null);
  const [liveSteps, setLiveSteps] = useState<NexusLiveStep[]>([]);
  const [shapingPayload, setShapingPayload] = useState<NexusShapingPayload | null>(null);
  const [shapingHeld, setShapingHeld] = useState(false);
  const shapingHeldRef = useRef(false);
  const [handoffSignal, setHandoffSignal] = useState<NexusHandoffSignal | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeConversationIdRef.current = conversationId ?? null;
  }, [conversationId]);

  useEffect(() => {
    shapingHeldRef.current = shapingHeld;
  }, [shapingHeld]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const { stream, abort: abortStream } = useAtlasStream();
  const streamingIdRef = useRef<string | null>(null);
  const cleanedUpRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepSeqRef = useRef(0);

  const resetStreamState = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    streamingIdRef.current = null;
    cleanedUpRef.current = true;
    setIsStreaming(false);
    setIsPending(false);
    setLiveStep(null);
    setLiveSteps([]);
  }, []);

  const abort = useCallback(() => {
    abortStream();
    resetStreamState();
  }, [abortStream, resetStreamState]);

  const clearMessages = useCallback(() => {
    activeConversationIdRef.current = null;
    setMessages([]);
    setShapingPayload(null);
    setHandoffSignal(null);
  }, []);

  const send = useCallback(async ({
    text,
    imageBase64,
    imageMimeType,
    overrideOptions,
  }: {
    text: string;
    imageBase64?: string;
    imageMimeType?: string;
    overrideOptions?: Partial<UseNexusChatStreamOptions>;
  }) => {
    if (!text.trim() || isPending) return;

    const routedText = routeDirectImageRequestToSketchPrompt(text);

    const resolvedModel = overrideOptions?.model ?? model;
    const resolvedMode = overrideOptions?.mode ?? mode;
    const history = messagesRef.current.map((m) => ({ role: m.role, content: m.content }));
    const userProfile = profileToString(loadProfile());

    setIsPending(true);
    setIsStreaming(true);
    const streamingId = Date.now().toString();
    streamingIdRef.current = streamingId;
    stepSeqRef.current = 0;
    cleanedUpRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (cleanedUpRef.current || streamingIdRef.current !== streamingId) return;

      abortStream();
      setMessages(prev => prev.map(m =>
        (m as any).id === streamingId
          ? {
              ...m,
              content: "Connection timed out. Tap send again to retry.",
              streaming: false,
              runStatus: "failed",
              errorMessage: "Stream timed out.",
            }
          : m
      ));
      resetStreamState();
    }, STREAM_TIMEOUT_MS);

    // Add user message
    const userMsg: NexusMessage = {
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    // ── Frontend short-circuit for image requests ─────────────────
    // /api/nexus/chat does not generate images. Route direct image
    // asks (and explicit [SKETCH:*] picks) to /api/image/generate
    // and render the result inline as an assistant message.
    const isImageIntent = shouldAutoRouteToSketchPrompt(text) || SKETCH_PROMPT_MARKER_RE.test(text);
    if (isImageIntent) {
      const imgPrompt = SKETCH_PROMPT_MARKER_RE.test(text)
        ? text.replace(SKETCH_PROMPT_MARKER_RE, "").trim()
        : routedText;
      try {
        const r = await fetch("/api/image/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ prompt: imgPrompt }),
        });
        const data = await r.json().catch(() => null) as any;
        if (!r.ok || !data?.b64_json) {
          throw new Error(data?.error ?? `HTTP ${r.status}`);
        }
        const dataUrl = `data:${data.mimeType ?? "image/png"};base64,${data.b64_json}`;
        setMessages(prev => [...prev, {
          id: streamingId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          model: resolvedModel,
          imageUrl: dataUrl,
          imageGen: { images: [{ imageUrl: dataUrl, prompt: imgPrompt }] },
          isNew: true,
        } as NexusMessage]);
      } catch (err: any) {
        console.error("[useNexusChatStream] image generate failed:", err);
        setMessages(prev => [...prev, {
          id: streamingId,
          role: "assistant",
          content: `Image generation failed: ${err?.message ?? "unknown error"}`,
          createdAt: new Date().toISOString(),
          model: resolvedModel,
        } as NexusMessage]);
      } finally {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setIsPending(false);
        setIsStreaming(false);
        resetStreamState();
      }
      return;
    }

    // Add streaming assistant bubble
    const assistantMsg: NexusMessage = {
      id: streamingId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      streaming: true,
      model: resolvedModel,
      isNew: true,
    };
    setMessages(prev => [...prev, assistantMsg]);
    const activeConversationId = activeConversationIdRef.current;

    try {
      await stream({
        endpoint: "/api/nexus/chat",
        body: {
          global: true,
          ...(activeConversationId ? { conversationId: activeConversationId } : {}),
          message: routedText,
          model: resolvedModel,
          history,
          mode: resolvedMode,
          userProfile,
        },

        callbacks: {
          onToken: (released) => {
            const cleaned = released
              .split('\n')
              .filter(line => {
                const t = line.trim();
                return !t.startsWith('VISUALIZE:') &&
                       !t.startsWith('READY_TO_SHAPE:') &&
                       !t.startsWith('NAVIGATE_TO:') &&
                       !t.startsWith('MEMORY_CHIPS:');
              })
              .join('\n')
              .replace(/VISUALIZE:\{[\s\S]*$/g, '')
              .replace(/READY_TO_SHAPE:\{[\s\S]*$/g, '');
            setMessages(prev => prev.map(m =>
              (m as any).id === streamingId
                ? { ...m, content: cleaned }
                : m
            ));
          },
          onStep: (step) => {
            const nextStep: NexusLiveStep = {
              id: `${streamingId}-${stepSeqRef.current++}`,
              verb: step.verb ?? "",
              target: step.target,
              detail: step.detail,
              status: step.status,
            };
            setLiveStep(nextStep);
            setLiveSteps(prev => [...prev, nextStep].slice(-6));
          },
          onDone: (fullText, meta) => {
            if (meta && !(meta as any).imageGen && (meta as any).image_gen) {
              (meta as any).imageGen = (meta as any).image_gen;
            }
            const doneConversationId = meta.conversationId;
            if (!activeConversationIdRef.current && typeof doneConversationId === "string" && doneConversationId) {
              activeConversationIdRef.current = doneConversationId;
            }

            // Parse NAVIGATE_TO
            let displayText = fullText;
            const navMatch = displayText.match(/NAVIGATE_TO:\{"route":"([^"]+)"\}/);
            if (navMatch) {
              const route = navMatch[1];
              displayText = displayText.replace(/\nNAVIGATE_TO:\{[^}]+\}/g, "").trim();
              setTimeout(() => { window.location.href = route; }, 800);
            }

            // Read shapingPayload from meta — backend parses and 
            // sends it in the done event already cleaned
            const shapingFromMeta = meta.shapingPayload as NexusShapingPayload | null | undefined;
            if (shapingFromMeta?.title && shapingFromMeta?.tension && !shapingHeldRef.current) {
              setShapingPayload(shapingFromMeta);
            }

            // Parse VISUALIZE marker
            const visualMatch = fullText.match(
              /VISUALIZE:\{([\s\S]*?)\}(?:\s|$)/
            ) || fullText.match(
              /VISUALIZE:(\{[\s\S]*\})/
            );
            if (visualMatch) {
              let visualData: { prompt: string; caption: string } | null = null;
              try {
                const rawJson = visualMatch[1].startsWith('{')
                  ? visualMatch[1]
                  : `{${visualMatch[1]}}`;
                visualData = JSON.parse(rawJson);
              } catch {
                const promptMatch = fullText.match(/"prompt":"([^"]+)"/);
                const captionMatch = fullText.match(/"caption":"([^"]+)"/);
                if (promptMatch) {
                  visualData = {
                    prompt: promptMatch[1],
                    caption: captionMatch?.[1] ?? "",
                  };
                }
              }

                if (visualData?.prompt) {
                  // Set loading state on the message
                  setMessages(prev => prev.map(m =>
                    (m as any).id === streamingId
                      ? { 
                          ...m, 
                          visualLoading: true,
                          visualCaption: visualData.caption ?? null,
                        }
                      : m
                  ));

                  // Fetch the image async — don't block onDone
                  fetch("/api/nexus/visualize", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                      prompt: visualData.prompt 
                    }),
                  })
                    .then(r => r.ok ? r.json() : null)
                    .then((data: { 
                      imageBase64?: string; 
                      mimeType?: string 
                    } | null) => {
                      if (data?.imageBase64) {
                        setMessages(prev => prev.map(m =>
                          (m as any).id === streamingId
                            ? {
                                ...m,
                                visualLoading: false,
                                visualImageBase64: data.imageBase64,
                              }
                            : m
                        ));
                      } else {
                        setMessages(prev => prev.map(m =>
                          (m as any).id === streamingId
                            ? { ...m, visualLoading: false }
                            : m
                        ));
                      }
                    })
                    .catch(() => {
                      setMessages(prev => prev.map(m =>
                        (m as any).id === streamingId
                          ? { ...m, visualLoading: false }
                          : m
                      ));
                    });
                }
            }


            // Parse MEMORY_CHIPS
            const chipMatch = displayText.match(/MEMORY_CHIPS:\s*(\[[\s\S]*?\])/);
            if (chipMatch) {
              try { JSON.parse(chipMatch[1]); } catch { /* non-fatal */ }
              displayText = displayText.replace(/\nMEMORY_CHIPS:[\s\S]*$/g, "").trim();
            }

            const handoff = meta.handoffSignal as NexusHandoffSignal | undefined;
            if (handoff) setHandoffSignal(handoff);
            const focusSuggestion = meta.focusSuggestion as NexusFocusSuggestion | undefined;

            setMessages(prev => prev.map(m =>
              (m as any).id === streamingId
                ? {
                    ...m,
                    content: displayText,
                    imageGen: ((meta as any).imageGen ?? null) as NexusMessage["imageGen"],
                    streaming: false,
                    handoffSignal: handoff ?? null,
                    focusSuggestion,
                    surface: (meta.surface ?? null) as string | null,
                    executionTimeMs: (meta.executionTimeMs ?? meta.execution_time_ms ?? null) as number | null,
                    inputTokens: (meta.inputTokens ?? meta.input_tokens ?? null) as number | null,
                    outputTokens: (meta.outputTokens ?? meta.output_tokens ?? null) as number | null,
                    costUsd: (meta.costUsd ?? (meta.cost_usd != null ? Number(meta.cost_usd) : null)) as number | null,
                    runStatus: (meta.runStatus ?? meta.run_status ?? "completed") as string,
                    runSummary: (meta.runSummary ?? meta.run_summary ?? null) as string | null,
                    modelUsed: (meta.modelUsed ?? meta.model_used ?? null) as string | null,
                  }
                : m
            ));

            resetStreamState();
          },
          onError: (errMsg) => {
            setMessages(prev => prev.map(m =>
              (m as any).id === streamingId
                ? {
                    ...m,
                    content: errMsg || "Something went wrong. Tap send again.",
                    streaming: false,
                    runStatus: "failed",
                    errorMessage: errMsg,
                  }
                : m
            ));
            resetStreamState();
          },
        },
      });
    } finally {
      // Always reset — even if stream threw unexpectedly
      resetStreamState();
    }
  }, [isPending, model, mode, stream, abortStream, resetStreamState]);

  return {
    messages,
    setMessages,
    isStreaming,
    isPending,
    liveStep,
    liveSteps,
    shapingPayload,
    setShapingPayload,
    shapingHeld,
    setShapingHeld,
    handoffSignal,
    send,
    abort,
    clearMessages,
  };
}
