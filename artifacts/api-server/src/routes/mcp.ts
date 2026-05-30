import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: object;
};

type McpServerInfo = {
  name?: string;
  version?: string;
};

// Fetch tools from an MCP server via SSE or HTTP
async function discoverMcpTools(url: string, token?: string): Promise<{ 
  serverInfo: McpServerInfo; 
  tools: McpTool[] 
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Send MCP initialize request
  const initRes = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        clientInfo: { name: "axiom-atlas", version: "1.0.0" }
      }
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!initRes.ok) {
    throw new Error(`MCP server returned ${initRes.status}`);
  }

  const initData = await initRes.json() as { 
    result?: { serverInfo?: McpServerInfo } 
  };
  const serverInfo = initData.result?.serverInfo ?? {};

  // Fetch tools list
  const toolsRes = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!toolsRes.ok) {
    throw new Error(`Tools list failed: ${toolsRes.status}`);
  }

  const toolsData = await toolsRes.json() as { 
    result?: { tools?: McpTool[] } 
  };
  const tools = toolsData.result?.tools ?? [];

  return { serverInfo, tools };
}

// POST /api/mcp/discover — test a server URL and return tools
router.post("/mcp/discover", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number;
  if (!userId) { 
    res.status(401).json({ error: "Not authenticated" }); 
    return; 
  }

  const { url, token } = req.body as { 
    url?: string; 
    token?: string 
  };
  
  if (!url?.trim()) { 
    res.status(400).json({ error: "url is required" }); 
    return; 
  }

  try {
    const { serverInfo, tools } = await discoverMcpTools(
      url.trim(), 
      token?.trim()
    );
    res.json({ serverInfo, tools, url: url.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to connect";
    res.status(422).json({ error: message });
  }
});

// POST /api/mcp/connect — save a verified MCP connection
router.post("/mcp/connect", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number;
  if (!userId) { 
    res.status(401).json({ error: "Not authenticated" }); 
    return; 
  }

  const { url, token, label, tools } = req.body as { 
    url: string; 
    token?: string; 
    label: string;
    tools: McpTool[];
  };

  if (!url?.trim() || !label?.trim()) { 
    res.status(400).json({ error: "url and label are required" }); 
    return; 
  }

  // Store in connections table
  const rows = await db.execute(sql`
    INSERT INTO connections (user_id, type, label, url, token, metadata, status)
    VALUES (
      ${userId}, 
      'mcp', 
      ${label.trim()}, 
      ${url.trim()}, 
      ${token?.trim() ?? null},
      ${JSON.stringify({ tools })}::jsonb,
      'linked'
    )
    ON CONFLICT DO NOTHING
    RETURNING id, type, label, url, status, created_at
  `);

  res.status(201).json(rows.rows[0]);
});

// GET /api/mcp/connections — list user's MCP connections
router.get("/mcp/connections", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number;
  if (!userId) { 
    res.status(401).json({ error: "Not authenticated" }); 
    return; 
  }

  const rows = await db.execute(sql`
    SELECT id, label, url, metadata, status, created_at
    FROM connections
    WHERE user_id = ${userId} AND type = 'mcp'
    ORDER BY created_at DESC
  `);

  // Return connections with tool count
  const connections = rows.rows.map((r: any) => ({
    id: r.id,
    label: r.label,
    url: r.url,
    status: r.status,
    toolCount: (r.metadata?.tools ?? []).length,
    tools: r.metadata?.tools ?? [],
    createdAt: r.created_at,
  }));

  res.json(connections);
});

// DELETE /api/mcp/connections/:id — remove an MCP connection
router.delete("/mcp/connections/:id", async (req, res): 
Promise<void> => {
  const userId = (req as any).authUser?.id as number;
  if (!userId) { 
    res.status(401).json({ error: "Not authenticated" }); 
    return; 
  }

  const id = Number(req.params.id);
  await db.execute(sql`
    DELETE FROM connections 
    WHERE id = ${id} AND user_id = ${userId} AND type = 'mcp'
  `);

  res.json({ deleted: true });
});

export default router;
