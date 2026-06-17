import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { useChatStream, type UseChatStreamOptions } from "@/hooks/useChatStream";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeOpts(): UseChatStreamOptions {
  return {
    sessions: [{ id: 42 } as any],
    sessionsLoading: false,
    createSession: { mutateAsync: async () => ({ id: 42 }) } as any,
    queryClient: {
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
      getQueryData: vi.fn(),
    } as any,
    getListSessionsQueryKey: (id: number) => ["sessions", id],
    mapPriorMessage: (m: any) => m,
    endpoint: "/api/chat",
    entries: [],
    fileContext: null,
    forgeContext: null,
    dbUrl: null,
    sendCtxRef: { current: { wsLens: "flow", wsModel: "multi", githubToken: null } } as any,
    setDetectedLens: vi.fn(),
    setScenarioBuffer: vi.fn(),
    setLeftTab: vi.fn(),
    setMobileTab: vi.fn(),
    setPendingResolvedNodeIds: vi.fn(),
    setAutoNameKey: vi.fn(),
    getGetProjectQueryKey: (id: number) => ["project", id],
    getListProjectsQueryKey: () => ["projects"],
    reportError: vi.fn(),
  };
}

describe("useChatStream — attachments regression", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse({ content: "ok" }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("POSTs /api/chat with attachments[] intact", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChatStream(1, opts));

    act(() => {
      result.current.doSend(
        "look at these",
        42,
        [],
        null,
        [
          { base64: "AAA", mediaType: "image/png", name: "one.png" },
          { base64: "BBB", mediaType: "image/jpeg", name: "two.jpg" },
        ],
      );
    });

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/api/chat")),
      ).toBeTruthy();
    });

    const chatCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/api/chat"))!;
    const init = chatCall[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(Array.isArray(body.attachments)).toBe(true);
    expect(body.attachments).toHaveLength(2);
    expect(body.attachments[0]).toMatchObject({ base64: "AAA", mediaType: "image/png" });
    expect(body.attachments[1]).toMatchObject({ base64: "BBB", mediaType: "image/jpeg" });
    // Legacy back-compat fields.
    expect(body.imageData).toBe("AAA");
    expect(body.imageMimeType).toBe("image/png");
  });

  it("omits attachments[] entirely when no images are supplied", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChatStream(1, opts));

    act(() => {
      result.current.doSend("plain text only", 42, []);
    });

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/api/chat")),
      ).toBeTruthy();
    });

    const chatCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/api/chat"))!;
    const body = JSON.parse(String((chatCall[1] as RequestInit).body));
    expect(body.attachments).toBeUndefined();
    expect(body.imageData).toBeUndefined();
  });

  it("filters non-image attachments before sending", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChatStream(1, opts));

    act(() => {
      result.current.doSend("mixed", 42, [], null, [
        { base64: "IMG", mediaType: "image/png" },
        { base64: "PDF", mediaType: "application/pdf" },
      ]);
    });

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/api/chat")),
      ).toBeTruthy();
    });

    const chatCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/api/chat"))!;
    const body = JSON.parse(String((chatCall[1] as RequestInit).body));
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].mediaType).toBe("image/png");
  });
});
