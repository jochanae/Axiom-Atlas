import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, mcpConnectionsTable } from "@workspace/db";
import type { McpTool } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";

const router: IRouter = Router();

function buildAuthHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function parseTools(raw: unknown): McpTool[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t): McpTool | null => {
      if (!t || typeof t !== "object") return null;
      const r = t as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : null;
      if (!name) return null;
      return { name, description: typeof r.description === "string" ? r.description : null };
    })
    .filter((t): t is McpTool => t !== null);
}

async function tryStreamableHttp(
  url: string,
  authHeaders: Record<string, string>,
): Promise<{ name: string; tools: McpTool[] } | null> {
  try {
    const postHeaders = { ...authHeaders, "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };

    const initRes = await fetch(url, {
      method: "POST",
      headers: postHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "Atlas", version: "1.0" },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!initRes.ok) return null;
    const contentType = initRes.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json") && !contentType.includes("text/plain")) return null;

    const initData = (await initRes.json()) as { result?: { serverInfo?: { name?: string } } };
    const serverName = initData?.result?.serverInfo?.name ?? "MCP Server";

    const toolsRes = await fetch(url, {
      method: "POST",
      headers: postHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(8000),
    });

    if (!toolsRes.ok) return { name: serverName, tools: [] };
    const toolsData = (await toolsRes.json()) as { result?: { tools?: unknown[] } };
    return { name: serverName, tools: parseTools(toolsData?.result?.tools) };
  } catch {
    return null;
  }
}

async function parseSseEvents(stream: ReadableStream<Uint8Array>): Promise<{ type: string; data: string }[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: { type: string; data: string }[] = [];

  try {
    for (let i = 0; i < 50; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block.split("\n");
        let type = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) type = line.slice(7).trim();
          else if (line.startsWith("data: ")) data = line.slice(6).trim();
        }
        if (data) events.push({ type, data });
      }

      if (events.some((e) => e.type === "endpoint")) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return events;
}

async function trySseMcp(
  url: string,
  authHeaders: Record<string, string>,
): Promise<{ name: string; tools: McpTool[] } | null> {
  try {
    const sseRes = await fetch(url, {
      headers: { ...authHeaders, Accept: "text/event-stream" },
      signal: AbortSignal.timeout(10000),
    });

    if (!sseRes.ok || !sseRes.body) return null;
    const contentType = sseRes.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) return null;

    const events = await parseSseEvents(sseRes.body);
    const endpointEvent = events.find((e) => e.type === "endpoint");
    if (!endpointEvent) return null;

    const endpointPath = endpointEvent.data;
    const baseUrl = new URL(url);
    const messagesUrl = endpointPath.startsWith("http")
      ? endpointPath
      : `${baseUrl.origin}${endpointPath.startsWith("/") ? "" : "/"}${endpointPath}`;

    const postHeaders = { ...authHeaders, "Content-Type": "application/json" };

    const initRes = await fetch(messagesUrl, {
      method: "POST",
      headers: postHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "Atlas", version: "1.0" },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    let serverName = "MCP Server";
    if (initRes.ok) {
      try {
        const initData = (await initRes.json()) as { result?: { serverInfo?: { name?: string } } };
        serverName = initData?.result?.serverInfo?.name ?? serverName;
      } catch {}
    }

    const toolsRes = await fetch(messagesUrl, {
      method: "POST",
      headers: postHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(8000),
    });

    if (!toolsRes.ok) return { name: serverName, tools: [] };
    const toolsData = (await toolsRes.json()) as { result?: { tools?: unknown[] } };
    return { name: serverName, tools: parseTools(toolsData?.result?.tools) };
  } catch {
    return null;
  }
}

async function discoverMcpServer(
  url: string,
  token: string | null,
): Promise<{ name: string; tools: McpTool[] }> {
  const authHeaders = buildAuthHeaders(token);

  const streamable = await tryStreamableHttp(url, authHeaders);
  if (streamable) return streamable;

  const sse = await trySseMcp(url, authHeaders);
  if (sse) return sse;

  throw new Error(
    "Could not connect to MCP server. Check the URL format — most hosted MCPs use an SSE endpoint like https://mcp.service.app/sse",
  );
}

function serializeConnection(row: typeof mcpConnectionsTable.$inferSelect) {
  const { token: _t, ...rest } = row;
  return {
    ...rest,
    tools: rest.tools ?? [],
    createdAt: rest.createdAt.toISOString(),
  };
}

router.get("/mcp/connections", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const rows = await db
    .select()
    .from(mcpConnectionsTable)
    .where(eq(mcpConnectionsTable.userId, userId))
    .orderBy(desc(mcpConnectionsTable.createdAt));
  res.json(rows.map(serializeConnection));
});

const DiscoverBody = z.object({
  url: z.string().url(),
  token: z.string().optional(),
});

router.post("/mcp/discover", async (req, res): Promise<void> => {
  const parsed = DiscoverBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "url is required and must be a valid URL" });
    return;
  }

  try {
    const result = await discoverMcpServer(parsed.data.url, parsed.data.token ?? null);
    res.json({ server: { name: result.name, tools: result.tools } });
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "Discovery failed" });
  }
});

const ConnectBody = z.object({
  url: z.string().url(),
  label: z.string().min(1),
  token: z.string().optional(),
  tools: z.array(z.object({ name: z.string(), description: z.string().nullish() })).optional(),
});

router.post("/mcp/connect", async (req, res): Promise<void> => {
  const parsed = ConnectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "url and label are required" });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const { url, label, token, tools } = parsed.data;

  const [row] = await db
    .insert(mcpConnectionsTable)
    .values({
      userId,
      url,
      label: label.trim(),
      token: token ? encryptToken(token) : null,
      tools: tools ?? [],
    })
    .returning();

  res.status(201).json(serializeConnection(row));
});

router.delete("/mcp/connections/:id", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db
    .delete(mcpConnectionsTable)
    .where(and(eq(mcpConnectionsTable.id, id), eq(mcpConnectionsTable.userId, userId)));
  res.sendStatus(204);
});

export default router;
