import { useCallback, useRef } from "react";
import { createTextPacer } from "@/lib/textPacer";

export interface AtlasStreamEvent {
  type: "token" | "step" | "done" | "error";
  data: unknown;
}

export interface AtlasStreamCallbacks {
  /** Called with each released text chunk from the pacer */
  onToken: (released: string) => void;
  /** Called when a step event arrives */
  onStep?: (step: { verb?: string; target?: string; detail?: string; status?: "ok" | "warn" | "fail" }) => void;
  /** Called when stream completes — receives final full text and raw meta */
  onDone: (fullText: string, meta: Record<string, unknown>) => void;
  /** Called on stream error */
  onError?: (message: string) => void;
}

export interface AtlasStreamOptions {
  /** The endpoint to POST to */
  endpoint: string;
  /** Request body — fully assembled by the caller */
  body: Record<string, unknown>;
  /** Optional extra headers */
  headers?: Record<string, string>;
  /** Callbacks for stream events */
  callbacks: AtlasStreamCallbacks;
  /** AbortController signal for cancellation */
  signal?: AbortSignal;
}

export interface UseAtlasStreamReturn {
  /** Start a streaming request */
  stream: (options: AtlasStreamOptions) => Promise<void>;
  /** Abort the current stream */
  abort: () => void;
}

export function useAtlasStream(): UseAtlasStreamReturn {
  const abortControllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const stream = useCallback(async (options: AtlasStreamOptions) => {
    const { endpoint, body, headers = {}, callbacks, signal } = options;

    // Cancel any existing stream
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Merge signals if caller provided one
    const mergedSignal = signal
      ? AbortSignal.any
        ? AbortSignal.any([controller.signal, signal])
        : controller.signal
      : controller.signal;

    let streamedText = "";

    const pacer = createTextPacer({
      onTick: (released) => {
        callbacks.onToken(released);
      },
    });

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        credentials: "include",
        body: JSON.stringify(body),
        signal: mergedSignal,
      });

      if (!res.ok) {
        let bodyText = "";
        try { bodyText = await res.text(); } catch { /* ignore */ }
        console.error(`[useAtlasStream] ${endpoint} -> HTTP ${res.status}`, bodyText.slice(0, 500));
        const errText = res.status === 413
          ? "Images are too large to send. Try fewer or smaller images."
          : res.status === 401
            ? "Session expired. Please sign in again."
            : `Atlas couldn't respond (HTTP ${res.status}). Try again.`;
        callbacks.onError?.(errText);
        return;
      }

      // Fallback: server returned JSON instead of SSE stream.
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        try {
          const json = await res.json() as Record<string, unknown>;
          const text = (json.response ?? json.content ?? json.message ?? "") as string;
          if (text) {
            streamedText = text;
            pacer.push(text);
          }
          await pacer.finish();
          callbacks.onDone(streamedText, json);
        } catch (e) {
          pacer.abort();
          callbacks.onError?.("Couldn't parse Atlas response.");
        }
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";


      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split("\n\n");
          buf = blocks.pop() ?? "";

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
                const token = JSON.parse(evtData) as string;
                streamedText += token;
                pacer.push(token);
              } else if (evtName === "step") {
                const step = JSON.parse(evtData) as {
                  verb?: string;
                  target?: string;
                  detail?: string;
                  status?: "ok" | "warn" | "fail";
                };
                if (step?.verb) callbacks.onStep?.(step);
              } else if (evtName === "done") {
                const meta = JSON.parse(evtData) as Record<string, unknown>;
                await pacer.finish();
                // Use content from meta if available (already cleaned)
                // otherwise use accumulated streamedText
                const finalText = (meta.content as string | undefined) ?? streamedText;
                callbacks.onDone(finalText, meta);
              } else if (evtName === "error") {
                pacer.abort();
                const errMsg = JSON.parse(evtData) as string;
                callbacks.onError?.(errMsg || "Something went wrong.");
              }
            } catch {
              // Non-fatal parse error — continue
            }
          }
        }
      } finally {
        pacer.abort();
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      callbacks.onError?.("Connection dropped. Tap send again to retry.");
    }
  }, []);

  return { stream, abort };
}
