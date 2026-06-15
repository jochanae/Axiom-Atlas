import { useCallback, useEffect, useRef, useState } from "react";
import { Message, Session, createSession, useCreateSession, getListSessionsQueryKey, getGetProjectQueryKey, getListProjectsQueryKey, useListMessages } from "@workspace/api-client-react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type {
  ChatMessage,
  BrowserResult,
  MemoryChip,
  FileEdit,
  LinePatch,
  AmbientSurface,
  ProjectScan,
} from "@/pages/workspace";
import type { Plan } from "@/lib/plan";
import type { WorkspaceLens } from "@/hooks/useChatLens";
import { loadProfile, profileToString } from "@/lib/userProfile";
import { getAuthHeaders } from "@/lib/api";
import { createTextPacer, type TextPacer } from "@/lib/textPacer";
import { extractSketchSubject, routeDirectImageRequestToSketchPrompt, shouldAutoRouteToSketchPrompt, SKETCH_PROMPT_MARKER_RE } from "@/lib/sketchStylePresets";

type PriorMessage = Message;

type LedgerEntryLike = { id: number | string; title: string; status: string };

const ARTIFACT_LINE_RE = /^ARTIFACT:\s*(\{.+\})$/m;
const HTML_CODE_BLOCK_RE = /```html\n([\s\S]*?)```/;

function processPreviewableContent(
  content: string,
  onPreviewCode?: (code: string) => void,
): string {
  const artifactMatch = content.match(ARTIFACT_LINE_RE);
  if (artifactMatch) {
    try {
      const artifact = JSON.parse(artifactMatch[1]) as { type?: unknown; title?: unknown; content?: unknown };
      if (typeof artifact.content === "string") {
        onPreviewCode?.(artifact.content);
        // Do NOT strip the artifact from content — return as-is so it renders inline
        return content;
      }
    } catch {
      // Leave malformed artifact text visible
    }
  }

  const htmlMatch = content.match(HTML_CODE_BLOCK_RE);
  const html = htmlMatch?.[1];
  if (html && html.split("\n").length > 15) {
    onPreviewCode?.(html);
  }

  return content;
}

export interface UseChatStreamOptions {
  sessions: Session[] | undefined;
  sessionsLoading: boolean;
  createSession: ReturnType<typeof useCreateSession>;
  queryClient: QueryClient;
  getListSessionsQueryKey: (projectId: number) => QueryKey;
  mapPriorMessage: (m: PriorMessage) => ChatMessage;
  endpoint?: "/api/chat" | "/api/nexus/chat";

  // B2c deps
  entries: LedgerEntryLike[] | undefined;
  fileContext: string | null;
  forgeContext: string | null;
  dbUrl: string | null;
  sendCtxRef: MutableRefObject<{ wsLens: WorkspaceLens; wsModel: string; githubToken: string | null }>;
  setDetectedLens: Dispatch<SetStateAction<WorkspaceLens | null>>;
  setScenarioBuffer: Dispatch<SetStateAction<Array<{ role: string; content: string }>>>;
  setLeftTab: Dispatch<SetStateAction<"chat" | "diff" | "blueprints" | "terminal">>;
  setMobileTab: Dispatch<SetStateAction<string>>;
  setPendingResolvedNodeIds: Dispatch<SetStateAction<string[]>>;
  setAutoNameKey: Dispatch<SetStateAction<number>>;
  getGetProjectQueryKey: (projectId: number) => QueryKey;
  getListProjectsQueryKey: () => QueryKey;
  reportError: (err: unknown, ctx?: { projectId?: number }) => void;
  onPreviewCode?: (code: string) => void;
  onFlowNodes?: (nodes: Array<{ id: string; type: string; label: string; question?: string; x: number; y: number }>) => void;
  onSendStart?: () => void;
  onStepEvent?: (event: { phase?: unknown; verb?: string; target?: string; status?: string }) => void;
  onFirstStreamingToken?: () => void;
  onDoneEvent?: (payload: any) => void;
}

export interface ActivityStreamState {
  active: boolean;
  content: string;
}

export type LiveStepState = { verb: string; target?: string; status?: string } | null;

export interface UseChatStreamReturn {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  historyMsgCountRef: MutableRefObject<number>;
  priorLoadedRef: MutableRefObject<boolean>;
  sessionId: number | null;
  setSessionId: Dispatch<SetStateAction<number | null>>;
  ensureSessionId: () => Promise<number>;
  chatPending: boolean;
  setChatPending: Dispatch<SetStateAction<boolean>>;
  activityStream: ActivityStreamState;
  setActivityStream: Dispatch<SetStateAction<ActivityStreamState>>;
  liveStep: LiveStepState;
  abortControllerRef: MutableRefObject<AbortController | null>;
  handleStop: () => void;
  memoryChips: MemoryChip[];
  setMemoryChips: Dispatch<SetStateAction<MemoryChip[]>>;
  doSend: (
    text: string,
    sid: number,
    currentMessages: ChatMessage[],
    ctx?: string | null,
    attachments?: Array<{ base64: string; mediaType: string; name?: string }>,
    options?: { displayAs?: ChatMessage["displayAs"]; planMode?: boolean },
  ) => void;
  handleRegenerate: (assistantMsgIndex: number) => void;
}

const GITHUB_AUTO_LINK_TOOL_CALL_LINE_RE = /^TOOL_CALL:\s*github\/auto-link$/;
const GITHUB_AUTO_LINK_SUCCESS = "GitHub sync complete.";
const GITHUB_AUTO_LINK_FAILURE = "GitHub sync failed — add token in Connections.";

function stripGithubAutoLinkToolCall(content: string): { content: string; found: boolean } {
  let found = false;
  const stripped = content
    .split("\n")
    .filter((line) => {
      if (GITHUB_AUTO_LINK_TOOL_CALL_LINE_RE.test(line.trim())) {
        found = true;
        return false;
      }
      return true;
    })
    .join("\n");
  return { content: stripped, found };
}

function appendGithubAutoLinkStatus(content: string, status: string | null): string {
  if (!status) return content;
  const trimmed = content.trimEnd();
  return trimmed ? `${trimmed}\n\n${status}` : status;
}

/**
 * Chat-stream hook — owns message state, session, pending/activity, memory chips,
 * doSend, handleRegenerate, and the per-session summarize effect.
 */
export function useChatStream(
  projectId: number,
  opts: UseChatStreamOptions,
): UseChatStreamReturn {
  const {
    sessions,
    sessionsLoading,
    createSession,
    queryClient,
    getListSessionsQueryKey,
    mapPriorMessage,
    endpoint = "/api/chat",
    entries,
    fileContext,
    forgeContext,
    dbUrl,
    sendCtxRef,
    setDetectedLens,
    setScenarioBuffer,
    setLeftTab,
    setMobileTab,
    setPendingResolvedNodeIds,
    setAutoNameKey,
    getGetProjectQueryKey,
    getListProjectsQueryKey,
    reportError,
    onPreviewCode,
    onFlowNodes,
    onSendStart,
    onStepEvent,
    onFirstStreamingToken,
    onDoneEvent,
  } = opts;

  // ---- message state ----
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const priorLoadedRef = useRef(false);
  const historyMsgCountRef = useRef<number>(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ---- session state ----
  const [sessionId, setSessionId] = useState<number | null>(null);
  const creatingSessionRef = useRef<Promise<number> | null>(null);

  // ---- chat-pending / activity stream / abort ----
  const [chatPending, setChatPending] = useState(false);
  const [activityStream, setActivityStream] = useState<ActivityStreamState>({ active: false, content: "" });
  const [liveStep, setLiveStep] = useState<LiveStepState>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    setLiveStep(null);
  }, []);

  // ---- memory chips (B2c) ----
  const [memoryChips, setMemoryChips] = useState<MemoryChip[]>([]);

  // Cross-project reset.
  useEffect(() => {
    setMessages([]);
    priorLoadedRef.current = false;
    historyMsgCountRef.current = 0;
    setSessionId(null);
    creatingSessionRef.current = null;
    try { abortControllerRef.current?.abort(); } catch { /* noop */ }
    abortControllerRef.current = null;
    setChatPending(false);
    setActivityStream({ active: false, content: "" });
    setLiveStep(null);
  }, [projectId]);

  // Prior-message hydration.
  const { data: priorMessages } = useListMessages(sessionId ?? 0, {
    query: { enabled: !!sessionId, queryKey: ["messages", sessionId] },
  });
  useEffect(() => {
    if (!priorMessages || priorMessages.length === 0 || priorLoadedRef.current) return;
    if (messagesRef.current.length > 0) {
      priorLoadedRef.current = true;
      historyMsgCountRef.current = messagesRef.current.length;
      return;
    }
    priorLoadedRef.current = true;
    historyMsgCountRef.current = priorMessages.length;
    setMessages(priorMessages.map(mapPriorMessage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorMessages]);

  const ensureSessionId = useCallback(async (): Promise<number> => {
    if (sessionId) return sessionId;
    if (!creatingSessionRef.current) {
      creatingSessionRef.current = createSession.mutateAsync(
        { projectId, data: { title: "Session", mode: "think" } }
      ).then((s) => {
        setSessionId(s.id);
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey(projectId) });
        return s.id;
      }).finally(() => {
        creatingSessionRef.current = null;
      });
    }
    return creatingSessionRef.current;
  }, [createSession, projectId, queryClient, getListSessionsQueryKey, sessionId]);

  useEffect(() => {
    if (sessionsLoading) return;
    if (sessions && sessions.length > 0) {
      if (!sessionId) setSessionId(sessions[0].id);
    } else if (!sessionId) {
      void ensureSessionId();
    }
  }, [ensureSessionId, sessionId, sessions, sessionsLoading]);

  // ---- doSend (B2c) ----
  const doSend = useCallback(
    (
      text: string,
      sid: number,
      currentMessages: ChatMessage[],
      ctx?: string | null,
      attachments?: Array<{ base64: string; mediaType: string; name?: string }>,
      options?: { displayAs?: ChatMessage["displayAs"]; planMode?: boolean },
    ) => {
      const imgAttachments = (attachments ?? []).filter((a) => a.mediaType?.startsWith("image/"));
      const firstImg = imgAttachments[0];
      const userMsg: ChatMessage = {
        role: "user",
        content: text,
        sentAt: new Date().toISOString(),
        displayAs: options?.displayAs,
        planMode: options?.planMode,
        ...(imgAttachments.length > 0 ? { attachments: imgAttachments } : {}),
        ...(firstImg ? { imageB64: firstImg.base64, imageMimeType: firstImg.mediaType } : {}),
      };
      const history = currentMessages.map((m) => ({ role: m.role, content: m.content }));
      const ledgerEntries = (entries || []).map((e) => ({ id: e.id, title: e.title, status: e.status }));
      const activeCtx = ctx !== undefined ? ctx : fileContext;

      onSendStart?.();
      setMessages((prev) => [...prev, userMsg]);
      setChatPending(true);
      setActivityStream({ active: true, content: "" });
      setLiveStep(null);

      const userProfileStr = profileToString(loadProfile());
      const routedText = imgAttachments.length > 0 ? text : routeDirectImageRequestToSketchPrompt(text);

      // ── Frontend short-circuit for image requests ─────────────────
      // The backend /api/chat handler does not have image-tool wiring,
      // so route direct image asks (and explicit [SKETCH:*] picks) to
      // the dedicated /api/image/generate endpoint and render the
      // result inline as an assistant message.
      const isImageIntent = imgAttachments.length === 0 && (shouldAutoRouteToSketchPrompt(text) || SKETCH_PROMPT_MARKER_RE.test(text));
      if (isImageIntent) {
        const sketchPreset = (text.match(SKETCH_PROMPT_MARKER_RE)?.[1] ?? routedText.match(SKETCH_PROMPT_MARKER_RE)?.[1])?.toLowerCase();
        const imgPrompt = extractSketchSubject(SKETCH_PROMPT_MARKER_RE.test(text) ? text : routedText);
        const styleLabel = (sketchPreset ?? "concept").replace(/^\w/, c => c.toUpperCase());
        const promptPreview = imgPrompt.length > 48 ? `${imgPrompt.slice(0, 48)}…` : imgPrompt;
        const sketchLines: string[] = [];
        const pushSketchStep = (line: string, step: { verb: string; target?: string }) => {
          sketchLines.push(`SKETCH_STEP: ${line}`);
          setActivityStream({ active: true, content: sketchLines.join("\n") });
          setLiveStep({ verb: step.verb, target: step.target, status: "ok" });
        };
        pushSketchStep(`Interpreting "${promptPreview}"`, { verb: "Interpreting", target: promptPreview });
        void (async () => {
          try {
            pushSketchStep(`Sketching ${styleLabel} style…`, { verb: "Sketching", target: `${styleLabel} style` });
            const { generateImage } = await import("@/lib/generateImage");
            const img = await generateImage(imgPrompt, {
              style: (sketchPreset as "concept" | "wireframe" | "moodboard" | "blueprint" | "photoreal" | undefined) ?? "concept",
            });
            pushSketchStep("Rendering image…", { verb: "Rendering", target: "image" });
            setMessages((prev) => [...prev, {
              id: Date.now(),
              role: "assistant",
              content: "",
              sentAt: new Date().toISOString(),
              imageB64: img.b64_json,
              imageMimeType: img.mimeType,
            } as ChatMessage]);
          } catch (err: any) {
            console.error("[useChatStream] image generate failed:", err);
            setMessages((prev) => [...prev, {
              id: Date.now(),
              role: "assistant",
              content: `Image generation failed: ${err?.message ?? "unknown error"}`,
              sentAt: new Date().toISOString(),
            } as ChatMessage]);
          } finally {
            setChatPending(false);
            setActivityStream({ active: false, content: "" });
            setLiveStep(null);
          }
        })();
        return;
      }

      // Read cached project scan from localStorage and send as compact map string
      let projectMap: string | undefined;
      try {
        const rawScan = localStorage.getItem(`atlas-scan-${projectId}`);
        if (rawScan) {
          const s = JSON.parse(rawScan) as ProjectScan;
          const lines = [
            `Repo: ${s.repo} (scanned ${s.scannedAt?.slice(0, 10) ?? "recently"})`,
            s.description ? `What it does: ${s.description}` : "",
            s.stack?.length ? `Stack: ${s.stack.join(", ")}` : "",
            s.routes?.length ? `Routes (${s.routes.length}): ${s.routes.slice(0, 15).join(", ")}` : "",
            s.pages?.length ? `Pages: ${s.pages.slice(0, 12).join(", ")}` : "",
            s.components?.length ? `Components: ${s.components.slice(0, 12).join(", ")}` : "",
            s.tables?.length ? `DB Tables: ${s.tables.join(", ")}` : "",
            `Auth: ${s.authEnabled ? "enabled" : "not found"}`,
            `Total files: ${s.totalFiles}`,
            s.summary ? `Summary: ${s.summary}` : "",
          ].filter(Boolean).join("\n");
          if (lines.trim()) projectMap = lines;
        }
      } catch { /* non-fatal */ }

      const lensCtx = sendCtxRef.current;
      const isScenario = lensCtx.wsLens === "scenario";
      const effectiveModel = lensCtx.wsModel && lensCtx.wsModel !== "multi" ? lensCtx.wsModel : undefined;
      const body = {
        sessionId: sid,
        ...(projectId ? { projectId } : {}),
        message: routedText,
        ...(effectiveModel ? { model: effectiveModel } : {}),
        orchestrate: !effectiveModel,
        workspaceLens: lensCtx.wsLens,
        scenarioMode: isScenario,
        history,
        entries: ledgerEntries,
        ...(activeCtx ? { fileContext: activeCtx } : {}),
        ...(userProfileStr ? { userProfile: userProfileStr } : {}),
        ...(projectMap ? { projectMap } : {}),
        ...(imgAttachments.length > 0
          ? {
              attachments: imgAttachments,
              // Legacy fields for backend compat with the pre-multi-image contract.
              imageData: firstImg!.base64,
              imageMimeType: firstImg!.mediaType,
            }
          : {}),
        ...(forgeContext ? { forgeContext } : {}),
        ...(dbUrl ? { dbUrl } : {}),
      };

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const stallGuard = setTimeout(() => {
        try { controller.abort(); } catch {}
      }, 90000);

      void (async () => {
        let streamingId: number | null = null;
        let streamingFinished = false;
        let pacer: TextPacer | null = null;
        try {
          const ghToken = (() => { try { return localStorage.getItem("atlas-github-token") || null; } catch { return null; } })();

          const r = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeaders(),
              ...(ghToken ? { "x-github-token": ghToken } : {}),
            },
            credentials: "include",
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (!r.ok || !r.body) {
            let bodyText = "";
            try { bodyText = await r.text(); } catch { /* ignore */ }
            console.error(`[useChatStream] ${endpoint} -> HTTP ${r.status}`, bodyText.slice(0, 500));
            throw new Error(`HTTP ${r.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`);
          }

          // Fallback: server returned JSON instead of SSE. Synthesize a single
          // assistant message so the rest of the pipeline still completes.
          const _contentType = r.headers.get("content-type") ?? "";
          if (!_contentType.includes("text/event-stream")) {
            const res = await r.json().catch(() => null) as any;
            if (!res) throw new Error("Empty response from chat endpoint");
            if (res && !res.imageGen && res.image_gen) res.imageGen = res.image_gen;
            streamingFinished = true;
            let ghStatus: string | null = null;
            const { found: ghFound } = stripGithubAutoLinkToolCall(typeof res.content === "string" ? res.content : "");
            if (ghFound) {
              try {
                const gr = await fetch("/api/github/auto-link", {
                  method: "POST", credentials: "include", headers: getAuthHeaders(),
                });
                ghStatus = gr.ok ? GITHUB_AUTO_LINK_SUCCESS : GITHUB_AUTO_LINK_FAILURE;
              } catch { ghStatus = GITHUB_AUTO_LINK_FAILURE; }
            }
            if (typeof res.content === "string") {
              const { content: stripped } = stripGithubAutoLinkToolCall(res.content);
              const driftMatch = stripped.match(/LENS_DRIFT:\s*(flow|build|look|scenario)/i);
              if (driftMatch) {
                const drifted = driftMatch[1].toLowerCase();
                if (drifted !== sendCtxRef.current.wsLens) setDetectedLens(drifted as any);
                res.content = stripped.replace(/\n?LENS_DRIFT:\s*(flow|build|look|scenario)\s*$/i, "").trim();
              } else {
                setDetectedLens(null);
                res.content = stripped;
              }
              res.content = appendGithubAutoLinkStatus(res.content, ghStatus);
            } else if (ghStatus) {
              res.content = ghStatus;
            }
            if (typeof res.content === "string") {
              res.content = processPreviewableContent(res.content, onPreviewCode);
            }
            const fes = (res.fileEdits ?? (res.fileEdit ? [res.fileEdit] : []));
            const lps = res.linePatches ?? [];
            const aff = res.autoFetchedFiles ?? [];
            const rawChips = res.memoryChips ?? [];
            const normalizedChips = rawChips.map((c: any) => typeof c === "string" ? { label: c } : c);
            setMessages((prev) => [...prev, {
              ...res,
              id: res.messageId ?? Date.now(), role: "assistant",
              content: (res.content ?? "").replace(/\nCONFIDENCE_ASSESSMENT:\{[^\n]+\}/g, "").trim(),
              intentType: res.intentType,
              terminalCmd: res.terminalCmd ?? res.terminal_cmd,
              terminalResult: res.terminalResult ?? res.terminal_result,
              ...(res.browserResult ? { browserResult: res.browserResult as BrowserResult } : {}),
              ...(res.researchResult ? { researchResult: res.researchResult } : {}),
              modelUsed: res.modelUsed ?? res.model_used ?? null,
              ...(res.plan ? { plan: res.plan } : {}),
              sentAt: new Date().toISOString(),
              model: res.model ?? sendCtxRef.current.wsModel,
              isDeepDive: !!res.isDeepDive,
              ...(fes.length > 0 ? { fileEdits: fes, fileEdit: fes[0] } : {}),
              ...(lps.length > 0 ? { linePatches: lps } : {}),
              ...(normalizedChips.length > 0 ? { memoryChips: normalizedChips } : {}),
              ...(res.imageB64
                ? { imageB64: res.imageB64, imageMimeType: res.imageMimeType }
                : res.imageGen?.images?.[0]?.imageUrl
                  ? (() => {
                      const raw = res.imageGen.images[0].imageUrl as string;
                      const match = raw.match(/^data:([^;]+);base64,(.+)$/);
                      return match
                        ? { imageB64: match[2], imageMimeType: match[1] }
                        : {};
                    })()
                  : {}),
              imageGen: res.imageGen ?? null,
              ...(aff.length > 0 ? { autoFetchedFiles: aff } : {}),
              surface: res.surface ?? null,
              executionTimeMs: res.executionTimeMs ?? null,
              inputTokens: res.inputTokens ?? null,
              outputTokens: res.outputTokens ?? null,
              costUsd: res.costUsd != null ? Number(res.costUsd) : null,
            }]);
            setActivityStream({ active: false, content: "" });
            if (isScenario) {
              setScenarioBuffer((prev) => [
                ...prev,
                { role: "user", content: text },
                { role: "assistant", content: res.content ?? "" },
              ]);
            }
            if (normalizedChips.length > 0) {
              setMemoryChips((prev) => {
                const merged = [...prev];
                for (const c of normalizedChips) {
                  if (!merged.some((m) => m.label === c.label)) merged.push(c);
                }
                return merged.slice(-12);
              });
            }
            if (res.resolvedNodes?.length) {
              setPendingResolvedNodeIds((prev) => {
                const merged = [...prev];
                for (const nodeId of res.resolvedNodes) {
                  if (!merged.includes(nodeId)) merged.push(nodeId);
                }
                return merged;
              });
            }
            if (res.flowNodes && res.flowNodes.length > 0 && onFlowNodes) {
              onFlowNodes(res.flowNodes);
            }
            if (res.autoName) {
              setAutoNameKey((k) => k + 1);
              queryClient.setQueryData(getGetProjectQueryKey(projectId), (old: unknown) => {
                if (old && typeof old === "object" && "name" in old) return { ...(old as object), name: res.autoName };
                return old;
              });
              queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
            }
            return;
          }

          const placeholderId = -Date.now();
          streamingId = placeholderId;
          let streamedText = "";
          let sawFirstToken = false;
          let githubAutoLinkStatus: string | null = null;
          let githubAutoLinkPromise: Promise<string> | null = null;
          setMessages((prev) => [
            ...prev,
            {
              id: placeholderId,
              role: "assistant",
              content: "",
              streaming: true,
              sentAt: new Date().toISOString(),
              model: sendCtxRef.current.wsModel,
            },
          ]);

          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const renderFrom = (raw: string) => {
            const { content } = stripGithubAutoLinkToolCall(raw);
            return appendGithubAutoLinkStatus(content, githubAutoLinkStatus);
          };
          // Pacer: decouples network token bursts from the visible reveal.
          // See src/lib/textPacer.ts + mem://design/conversational-flow.
          pacer = createTextPacer({
            onTick: (released) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === placeholderId ? { ...m, content: renderFrom(released) } : m
                )
              );
            },
          });
          const triggerGithubAutoLink = (content: string) => {
            if (githubAutoLinkPromise) return;
            const { found } = stripGithubAutoLinkToolCall(content);
            if (!found) return;
            githubAutoLinkPromise = (async () => {
              let status = GITHUB_AUTO_LINK_FAILURE;
              try {
                const res = await fetch("/api/github/auto-link", {
                  method: "POST",
                  credentials: "include",
                  headers: getAuthHeaders(),
                });
                if (res.ok) status = GITHUB_AUTO_LINK_SUCCESS;
              } catch {
                status = GITHUB_AUTO_LINK_FAILURE;
              }
              githubAutoLinkStatus = status;
              // Re-emit current paced text with new suffix.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === placeholderId
                    ? { ...m, content: renderFrom(streamedText.slice(0, pacer?.released() ?? 0)) }
                    : m
                )
              );
              return status;
            })();
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";

            for (const block of blocks) {
              let evtName = "";
              let evtData = "";
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) evtName = line.slice(7).trim();
                else if (line.startsWith("data: ")) evtData = line.slice(6);
              }
              if (!evtData) continue;

              try {
                if (evtName === "token") {
                  const chunk = JSON.parse(evtData) as string;
                  if (!sawFirstToken) {
                    sawFirstToken = true;
                    onFirstStreamingToken?.();
                  }
                  streamedText += chunk;
                  triggerGithubAutoLink(streamedText);
                  // Feed the pacer instead of writing to React state directly.
                  // The pacer's rAF loop will release chars at human reading cadence
                  // and call setMessages at most once per frame.
                  pacer?.push(chunk);
                } else if (evtName === "narration") {
                  const text = JSON.parse(evtData) as string;
                  setActivityStream({ active: true, content: text });
                } else if (evtName === "step") {
                  const step = JSON.parse(evtData) as {
                    phase?: unknown;
                    verb?: string;
                    target?: string;
                    status?: string;
                  };
                  if (step?.verb) {
                    setLiveStep({ verb: step.verb, target: step.target, status: step.status });
                    onStepEvent?.(step);
                  }
                } else if (evtName === "done") {
                  const res = JSON.parse(evtData);
                  // Normalize snake_case → camelCase so we don't miss image payloads
                  if (res && !res.imageGen && res.image_gen) res.imageGen = res.image_gen;
                  if (res?.imageGen) {
                    console.log("[useChatStream] done event has imageGen:", {
                      count: res.imageGen?.images?.length,
                      firstUrlPrefix: res.imageGen?.images?.[0]?.imageUrl?.slice(0, 50),
                    });
                  }
                  if (res) onDoneEvent?.(res);
                  streamingFinished = true;
                  // Drain any remaining buffered text BEFORE swapping the placeholder
                  // out for the final message, so the user sees the reveal finish
                  // rather than a sudden jump to the full content.
                  await (pacer?.finish() ?? Promise.resolve());
                  setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
                  streamingId = null;
                  if (!res) return;
          if (typeof res.content === "string") triggerGithubAutoLink(res.content);
          if (githubAutoLinkPromise) await githubAutoLinkPromise;
          if (res.content && typeof res.content === "string") {
            const { content: contentWithoutToolCall } = stripGithubAutoLinkToolCall(res.content);
            const driftMatch = contentWithoutToolCall.match(/LENS_DRIFT:\s*(flow|build|look|scenario)/i);
            if (driftMatch) {
              const drifted = driftMatch[1].toLowerCase();
              if (drifted !== sendCtxRef.current.wsLens) setDetectedLens(drifted as any);
              res.content = contentWithoutToolCall.replace(/\n?LENS_DRIFT:\s*(flow|build|look|scenario)\s*$/i, "").trim();
            } else {
              setDetectedLens(null);
              res.content = contentWithoutToolCall;
            }
            res.content = appendGithubAutoLinkStatus(res.content, githubAutoLinkStatus);
          } else if (githubAutoLinkStatus) {
            res.content = githubAutoLinkStatus;
          }
          if (typeof res.content === "string") {
            res.content = processPreviewableContent(res.content, onPreviewCode);
          }
          const fes = (res.fileEdits ?? (res.fileEdit ? [res.fileEdit] : []));
          const lps = res.linePatches ?? [];
          const aff = res.autoFetchedFiles ?? [];
          const rawChips = res.memoryChips ?? [];
          const normalizedChips = rawChips.map((c: any) => typeof c === "string" ? { label: c } : c);
          setMessages((prev) => [...prev, {
            ...res,
            id: res.messageId, role: "assistant",
            content: (res.content ?? "").replace(/\nCONFIDENCE_ASSESSMENT:\{[^\n]+\}/g, "").trim(), intentType: res.intentType,
            terminalCmd: res.terminalCmd ?? res.terminal_cmd,
            terminalResult: res.terminalResult ?? res.terminal_result,
            ...(res.browserResult ? { browserResult: res.browserResult as BrowserResult } : {}),
            ...(res.researchResult ? { researchResult: res.researchResult } : {}),
            modelUsed: res.modelUsed ?? res.model_used ?? null,
            ...(res.plan ? { plan: res.plan } : {}),
            sentAt: new Date().toISOString(),
            model: res.model ?? sendCtxRef.current.wsModel,
            isDeepDive: !!res.isDeepDive,
            ...(fes.length > 0 ? { fileEdits: fes, fileEdit: fes[0] } : {}),
            ...(lps.length > 0 ? { linePatches: lps } : {}),
            ...(normalizedChips.length > 0 ? { memoryChips: normalizedChips } : {}),
            ...(res.imageB64
              ? { imageB64: res.imageB64, imageMimeType: res.imageMimeType }
              : res.imageGen?.images?.[0]?.imageUrl
                ? (() => {
                    const raw = res.imageGen.images[0].imageUrl as string;
                    const match = raw.match(/^data:([^;]+);base64,(.+)$/);
                    return match
                      ? { imageB64: match[2], imageMimeType: match[1] }
                      : {};
                  })()
                : {}),
            imageGen: res.imageGen ?? null,
            ...(aff.length > 0 ? { autoFetchedFiles: aff } : {}),
            surface: res.surface ?? null,
            executionTimeMs: res.executionTimeMs ?? null,
            inputTokens: res.inputTokens ?? null,
            outputTokens: res.outputTokens ?? null,
            costUsd: res.costUsd != null ? Number(res.costUsd) : null,
          }]);
          setActivityStream({ active: false, content: "" });
          if (isScenario) {
            setScenarioBuffer((prev) => [
              ...prev,
              { role: "user", content: text },
              { role: "assistant", content: res.content ?? "" },
            ]);
          }
          if (normalizedChips.length > 0) {
            setMemoryChips((prev) => {
              const merged = [...prev];
              for (const c of normalizedChips) {
                if (!merged.some((m) => m.label === c.label)) merged.push(c);
              }
              return merged.slice(-12);
            });
          }
          if (res.resolvedNodes?.length) {
            setPendingResolvedNodeIds((prev) => {
              const merged = [...prev];
              for (const nodeId of res.resolvedNodes) {
                if (!merged.includes(nodeId)) merged.push(nodeId);
              }
              return merged;
            });
          }
          if (res.flowNodes && res.flowNodes.length > 0 && onFlowNodes) {
            onFlowNodes(res.flowNodes);
          }
          if (res.autoName) {
            setAutoNameKey((k) => k + 1);
            queryClient.setQueryData(getGetProjectQueryKey(projectId), (old: unknown) => {
              if (old && typeof old === "object" && "name" in old) return { ...(old as object), name: res.autoName };
              return old;
            });
            queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          }
                }
              } catch {
                // malformed event — skip
              }
            }
          }
        } catch (err: unknown) {
          try { pacer?.abort(); } catch { /* noop */ }
          if (streamingId !== null) {
            setMessages((prev) => prev.filter((m) => m.id !== streamingId));
          }
          if (err instanceof Error && err.name === "AbortError") {
            setActivityStream({ active: false, content: "" });
            return;
          }
          void reportError(err, { projectId });
          setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again.", sentAt: new Date().toISOString() }]);
          setActivityStream({ active: false, content: "" });
        } finally {
          clearTimeout(stallGuard);
          try { pacer?.abort(); } catch { /* noop */ }
          if (!streamingFinished && streamingId !== null) {
            setMessages((prev) => prev.filter((m) => m.id !== streamingId));
          }
          setChatPending(false);
          setLiveStep(null);
          abortControllerRef.current = null;
        }
      })();
    },
    [entries, projectId, fileContext, forgeContext, dbUrl, sendCtxRef, setDetectedLens, setScenarioBuffer, setLeftTab, setMobileTab, setPendingResolvedNodeIds, setAutoNameKey, queryClient, getGetProjectQueryKey, getListProjectsQueryKey, reportError, onPreviewCode, onFlowNodes, onSendStart, onStepEvent, onFirstStreamingToken, onDoneEvent],
  );

  const handleRegenerate = useCallback(
    (assistantMsgIndex: number) => {
      if (!sessionId || chatPending) return;
      const msgsUpToAssistant = messages.slice(0, assistantMsgIndex);
      const prevUserMsg = [...msgsUpToAssistant].reverse().find((m) => m.role === "user");
      if (!prevUserMsg) return;
      const historyUpToPrevUser = msgsUpToAssistant.slice(0, msgsUpToAssistant.lastIndexOf(prevUserMsg));
      setMessages(msgsUpToAssistant.slice(0, msgsUpToAssistant.lastIndexOf(prevUserMsg) + 1));
      doSend(prevUserMsg.content, sessionId, historyUpToPrevUser);
    },
    [sessionId, chatPending, messages, doSend],
  );

  // ---- summarize effect (B2c) ----
  const summarizedSessionRef = useRef<number | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    const assistantCount = messages.filter((m) => m.role === "assistant").length;
    if (assistantCount < 2) return;
    const onHide = () => {
      if (!document.hidden) return;
      if (summarizedSessionRef.current === sessionId) return;
      summarizedSessionRef.current = sessionId;
      void fetch(`/api/sessions/${sessionId}/summarize`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
      });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [sessionId, messages]);

  return {
    messages,
    setMessages,
    messagesRef,
    historyMsgCountRef,
    priorLoadedRef,
    sessionId,
    setSessionId,
    ensureSessionId,
    chatPending,
    setChatPending,
    activityStream,
    setActivityStream,
    liveStep,
    abortControllerRef,
    handleStop,
    memoryChips,
    setMemoryChips,
    doSend,
    handleRegenerate,
  };
}
