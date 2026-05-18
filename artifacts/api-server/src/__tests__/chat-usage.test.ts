import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { mockDbState, makeTable, anthropicCreate } = vi.hoisted(() => {
  const mockDbState = {
    selectResults: [] as any[][],
    chatInserts: [] as any[],
  };

  const makeTable = (name: string) =>
    new Proxy({ tableName: name } as Record<string, unknown>, {
      get: (target, prop) => prop in target ? target[prop as string] : { tableName: name, name: String(prop) },
    });

  const anthropicCreate = vi.fn();
  return { mockDbState, makeTable, anthropicCreate };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    messages = { create: anthropicCreate };
  },
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class GoogleGenAIMock {
    models = { generateContent: vi.fn() };
  },
}));

vi.mock("openai", () => ({
  default: class OpenAIMock {
    chat = { completions: { create: vi.fn() } };
  },
}));

vi.mock("../lib/vaultContext", () => ({
  loadVaultContext: vi.fn().mockResolvedValue({ imageBlocks: [], systemNote: "", hasImages: false }),
}));

vi.mock("../lib/urlScreenshot", () => ({
  extractPageUrls: vi.fn().mockReturnValue([]),
  screenshotUrlsToBlocks: vi.fn().mockResolvedValue([]),
  buildUrlNote: vi.fn().mockReturnValue(""),
}));

vi.mock("@workspace/db", () => {
  const tables = {
    atlasErrorLogsTable: makeTable("atlas_error_logs"),
    atlasSelfMapTable: makeTable("atlas_self_map"),
    chatMessagesTable: makeTable("chat_messages"),
    db: undefined,
    entriesTable: makeTable("entries"),
    projectsTable: makeTable("projects"),
    secretsTable: makeTable("secrets"),
    sessionsTable: makeTable("sessions"),
  };

  const makeSelectChain = (result: any[]) => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(result),
      then: (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return chain;
  };

  const db = {
    select: vi.fn(() => makeSelectChain(mockDbState.selectResults.shift() ?? [])),
    insert: vi.fn((table: any) => ({
      values: vi.fn((value: any) => {
        if (table?.tableName === "chat_messages") mockDbState.chatInserts.push(value);
        return {
          returning: vi.fn(() => Promise.resolve([{ id: mockDbState.chatInserts.length }])),
          then: (onFulfilled: any, onRejected: any) => Promise.resolve([]).then(onFulfilled, onRejected),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
  };

  return { ...tables, db };
});

function createChatTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).authUser = { id: 1 };
    next();
  });
  app.use("/api", chatRouter);
  return app;
}

import chatRouter from "../routes/chat";

beforeEach(() => {
  mockDbState.selectResults = [];
  mockDbState.chatInserts = [];
  anthropicCreate.mockReset();
});

describe("POST /api/chat usage tracking", () => {
  it("stores assistant message usage fields and positive cost", async () => {
    mockDbState.selectResults.push(
      [{ id: 7, name: "Tracked Project", memory: null, linkedRepo: null, githubToken: null, nodeState: {} }],
      [],
      [],
      [{ name: "Tracked Project", description: null }],
      [],
    );
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Tracked response" }],
      usage: { input_tokens: 1000, output_tokens: 200 },
    });

    const res = await request(createChatTestApp())
      .post("/api/chat")
      .send({ sessionId: 11, projectId: 7, message: "Help me think this through", history: [{ role: "assistant", content: "Prior context" }] });

    expect(res.status).toBe(200);
    const assistantInsert = mockDbState.chatInserts.find((value) => value.role === "assistant");
    expect(assistantInsert).toMatchObject({
      executionTimeMs: expect.any(Number),
      inputTokens: 1000,
      outputTokens: 200,
    });
    expect(Number(assistantInsert.costUsd)).toBeGreaterThan(0);
  });
});
