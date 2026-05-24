import { Router, type Request, type Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "../lib/logger";
import { getUserFromCookie } from "./auth";
import {
  getOrCreatePtySession,
  ptyWrite,
  ptyResize,
  setPtySafety,
  killPtySession,
  getPtySessionForUser,
  type SafetyLevel,
  ptyExecCommand,
} from "../lib/ptySession";

// Types for WebSocket messages
interface WsMessage {
  type: "input" | "resize" | "safety" | "exec" | "kill";
  data?: string;
  cols?: number;
  rows?: number;
  safety?: SafetyLevel;
  command?: string;
  timeout?: number;
}

interface TerminalWsClient {
  ws: WebSocket;
  userId: number;
  sessionId: string | null;
  alive: boolean;
}

const clients = new Map<WebSocket, TerminalWsClient>();
let wss: WebSocketServer | null = null;

// ── Initialize WebSocket server ────────────────────────────────────────────────────────
export function initTerminalWs(server: import("http").Server): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket, req: Request) => {
    const userId = (req as any).authUser?.id as number | undefined;
    if (!userId) {
      ws.close(4001, "Unauthorized");
      return;
    }

    const client: TerminalWsClient = {
      ws,
      userId,
      sessionId: null,
      alive: true,
    };
    clients.set(ws, client);

    // Start heartbeat
    const heartbeatInterval = setInterval(() => {
      if (!client.alive) {
        ws.terminate();
        clearInterval(heartbeatInterval);
        return;
      }
      client.alive = false;
      ws.ping();
    }, 30000);

    ws.on("pong", () => {
      client.alive = true;
    });

    ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const text = Buffer.isBuffer(raw) ? raw.toString("utf-8") : String(raw);
        const msg = JSON.parse(text) as WsMessage;
        handleMessage(client, msg);
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", text: "Invalid message format" }));
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeatInterval);
      clients.delete(ws);
      // Session persists for reconnect
    });

    ws.on("error", (err) => {
      logger.error({ err, userId }, "Terminal WebSocket error");
    });

    // Send ready message
    ws.send(JSON.stringify({ type: "ready", text: "Connected to Atlas Terminal" }));
  });

  // Handle HTTP upgrade for WebSocket
  server.on("upgrade", async (request, socket, head) => {
    if (!request.url?.startsWith("/api/terminal/ws")) {
      return; // Let other handlers handle non-terminal upgrades
    }

    // Auth via cookie
    const cookieHeader = request.headers.cookie ?? "";
    // Parse cookies manually from the raw header
    const cookies: Record<string, string> = {};
    for (const c of cookieHeader.split(";")) {
      const [k, v] = c.trim().split("=");
      if (k && v) cookies[k] = decodeURIComponent(v);
    }
    const token = cookies["atlas-session"];

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      // Build a minimal request-like object for getUserFromCookie
      const mockReq = { cookies: { ["atlas-session"]: token } } as any;
      const user = await getUserFromCookie(mockReq);
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      (request as any).authUser = user;
      wss?.handleUpgrade(request, socket, head, (ws) => {
        wss?.emit("connection", ws, request);
      });
    } catch (err) {
      logger.error({ err }, "Terminal WS auth lookup failed");
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  return wss;
}

function handleMessage(client: TerminalWsClient, msg: WsMessage): void {
  switch (msg.type) {
    case "input":
      handleInput(client, msg.data ?? "");
      break;
    case "resize":
      handleResize(client, msg.cols ?? 120, msg.rows ?? 30);
      break;
    case "safety":
      handleSafety(client, msg.safety ?? "full");
      break;
    case "exec":
      handleExec(client, msg.command ?? "", msg.timeout ?? 30000);
      break;
    case "kill":
      handleKill(client);
      break;
    default:
      client.ws.send(JSON.stringify({ type: "error", text: "Unknown message type" }));
  }
}

function getSession(client: TerminalWsClient) {
  if (!client.sessionId) {
    const session = getOrCreatePtySession(client.userId, "full");
    client.sessionId = session.id;
    session.onOutput = (text: string) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: "output", text }));
      }
    };
    session.onExit = () => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: "exit" }));
      }
    };
    return session;
  }
  const session = getPtySessionForUser(client.userId);
  if (!session) {
    const newSession = getOrCreatePtySession(client.userId, "full");
    client.sessionId = newSession.id;
    newSession.onOutput = (text: string) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: "output", text }));
      }
    };
    return newSession;
  }
  return session;
}

function handleInput(client: TerminalWsClient, data: string): void {
  const session = getSession(client);
  ptyWrite(session.id, data);
}

function handleResize(client: TerminalWsClient, cols: number, rows: number): void {
  if (!client.sessionId) return;
  ptyResize(client.sessionId, cols, rows);
}

function handleSafety(client: TerminalWsClient, safety: SafetyLevel): void {
  if (!client.sessionId) return;
  setPtySafety(client.sessionId, safety);
  client.ws.send(JSON.stringify({ type: "status", text: `Safety set to ${safety}` }));
}

async function handleExec(client: TerminalWsClient, command: string, timeout: number): Promise<void> {
  if (!client.sessionId) return;
  try {
    const result = await ptyExecCommand(client.sessionId, command, timeout);
    client.ws.send(JSON.stringify({
      type: "exec-done",
      command,
      output: result.output,
      exitCode: result.exitCode,
    }));
  } catch (err: any) {
    client.ws.send(JSON.stringify({
      type: "exec-error",
      command,
      error: err.message ?? String(err),
    }));
  }
}

function handleKill(client: TerminalWsClient): void {
  if (client.sessionId) {
    killPtySession(client.sessionId);
    client.sessionId = null;
  }
  client.ws.send(JSON.stringify({ type: "status", text: "Session killed" }));
}

// ── Express routes for safety preference (REST API, not WS) ───────────────
const router = Router();

// GET /api/terminal/safety — get current safety level
router.get("/terminal/safety", async (req: Request, res: Response): Promise<void> => {
  const user = await getUserFromCookie(req);
  if (!user) { res.status(401).json({ error: "Authentication required" }); return; }
  const session = getPtySessionForUser(user.id);
  res.json({
    safety: session?.safety ?? "full",
    connected: !!session,
  });
});

// POST /api/terminal/safety — set safety level
router.post("/terminal/safety", async (req: Request, res: Response): Promise<void> => {
  const user = await getUserFromCookie(req);
  if (!user) { res.status(401).json({ error: "Authentication required" }); return; }
  const { safety } = req.body as { safety?: SafetyLevel };
  if (safety !== "full" && safety !== "nuclear") {
    res.status(400).json({ error: "Invalid safety level. Use 'full' or 'nuclear'." });
    return;
  }
  const session = getPtySessionForUser(user.id);
  if (session) {
    setPtySafety(session.id, safety);
  }
  res.json({ safety, applied: !!session });
});

export default router;
