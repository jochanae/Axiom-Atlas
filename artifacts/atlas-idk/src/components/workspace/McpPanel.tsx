import { useCallback, useEffect, useState } from "react";
import type React from "react";

type McpTool = {
  name: string;
  description?: string | null;
};

type DiscoveredServer = {
  name: string;
  tools: McpTool[];
};

type McpConnection = {
  id: number | string;
  label: string;
  url: string;
  tools?: McpTool[];
};

type McpPanelProps = {
  projectId: number;
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--atlas-border)",
  borderRadius: 8,
  padding: "9px 10px",
  background: "var(--atlas-surface)",
  color: "var(--atlas-fg)",
  fontFamily: "var(--app-font-mono)",
  fontSize: 12,
  outline: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--atlas-gold)",
  borderRadius: 999,
  padding: "8px 12px",
  background: "transparent",
  color: "var(--atlas-gold)",
  cursor: "pointer",
  fontFamily: "var(--app-font-mono)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--atlas-border)",
  borderRadius: 999,
  padding: "6px 10px",
  background: "transparent",
  color: "var(--atlas-muted)",
  cursor: "pointer",
  fontFamily: "var(--app-font-mono)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

function normalizeTools(value: unknown): McpTool[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((tool): McpTool | null => {
      if (!tool || typeof tool !== "object") return null;
      const record = tool as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : null;
      if (!name) return null;

      return {
        name,
        description: typeof record.description === "string" ? record.description : null,
      };
    })
    .filter((tool): tool is McpTool => tool !== null);
}

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

async function readErrorResponse(res: Response) {
  try {
    const data = await res.json();
    if (typeof data?.error === "string") return data.error;
    if (typeof data?.message === "string") return data.message;
  } catch {
    const text = await res.text().catch(() => "");
    if (text) return text;
  }

  return `HTTP ${res.status}`;
}

export function McpPanel({ projectId }: McpPanelProps) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredServer | null>(null);
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<McpConnection["id"]>>(new Set());
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true);
    setError(null);

    try {
      const res = await fetch("/api/mcp/connections", {
        credentials: "include",
      });

      if (!res.ok) throw new Error(await readErrorResponse(res));

      const data = await res.json();
      const items = (Array.isArray(data) ? data : data?.connections ?? []) as McpConnection[];
      setConnections(items);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load MCP connections"));
      setConnections([]);
    } finally {
      setLoadingConnections(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const handleDiscover = async () => {
    setDiscovering(true);
    setError(null);
    setDiscovered(null);

    try {
      const res = await fetch("/api/mcp/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url, token }),
      });

      if (!res.ok) throw new Error(await readErrorResponse(res));

      const data = await res.json();
      const server = data?.server && typeof data.server === "object" ? data.server : data;
      const serverName =
        typeof server?.name === "string"
          ? server.name
          : typeof data?.serverName === "string"
          ? data.serverName
          : "MCP Server";

      setDiscovered({
        name: serverName,
        tools: normalizeTools(server?.tools ?? data?.tools),
      });
    } catch (err) {
      setError(getErrorMessage(err, "Could not discover MCP tools"));
    } finally {
      setDiscovering(false);
    }
  };

  const handleSave = async () => {
    if (!discovered) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/mcp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url, token, label, tools: discovered.tools }),
      });

      if (!res.ok) throw new Error(await readErrorResponse(res));

      await loadConnections();
    } catch (err) {
      setError(getErrorMessage(err, "Could not save MCP connection"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (connectionId: McpConnection["id"]) => {
    setError(null);

    try {
      const res = await fetch(`/api/mcp/connections/${connectionId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) throw new Error(await readErrorResponse(res));

      await loadConnections();
    } catch (err) {
      setError(getErrorMessage(err, "Could not delete MCP connection"));
    }
  };

  const toggleConnection = (connectionId: McpConnection["id"]) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(connectionId)) {
        next.delete(connectionId);
      } else {
        next.add(connectionId);
      }
      return next;
    });
  };

  return (
    <div
      data-project-id={projectId}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        flex: 1,
        minHeight: 0,
        padding: 16,
        background: "var(--atlas-surface)",
        color: "var(--atlas-fg)",
        fontFamily: "var(--app-font-mono)",
        overflowY: "auto",
      }}
    >
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          border: "1px solid var(--atlas-border)",
          borderRadius: 12,
          padding: 14,
          background: "var(--atlas-surface)",
        }}
      >
        <div
          style={{
            color: "var(--atlas-gold)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Add Connection
        </div>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://mcp.linear.app/sse"
          style={inputStyle}
        />
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Bearer token — optional"
          type="password"
          style={inputStyle}
        />
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder='"Linear", "Notion", etc.'
          style={inputStyle}
        />
        <button
          type="button"
          disabled={discovering || !url.trim()}
          onClick={() => void handleDiscover()}
          style={{
            ...primaryButtonStyle,
            alignSelf: "flex-start",
            cursor: discovering || !url.trim() ? "not-allowed" : "pointer",
            opacity: discovering || !url.trim() ? 0.55 : 1,
          }}
        >
          {discovering ? "Connecting..." : "Discover Tools"}
        </button>

        {discovered && (
          <div
            style={{
              border: "1px solid var(--atlas-border)",
              borderRadius: 10,
              padding: 12,
              background: "var(--atlas-surface-alt)",
            }}
          >
            <div style={{ color: "var(--atlas-fg)", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              {discovered.name}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {discovered.tools.map((tool) => (
                <div key={tool.name}>
                  <div style={{ color: "var(--atlas-fg)", fontSize: 11 }}>{tool.name}</div>
                  {tool.description && (
                    <div style={{ color: "var(--atlas-muted)", fontSize: 10, marginTop: 2 }}>
                      {tool.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              style={{
                ...primaryButtonStyle,
                marginTop: 12,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.55 : 1,
              }}
            >
              {saving ? "Saving..." : "Save Connection"}
            </button>
          </div>
        )}

        {error && (
          <div
            style={{
              border: "1px solid color-mix(in oklab, var(--atlas-ember) 35%, var(--atlas-border))",
              borderRadius: 10,
              padding: 10,
              color: "var(--atlas-ember)",
              fontSize: 11,
            }}
          >
            {error}
          </div>
        )}
      </section>

      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          border: "1px solid var(--atlas-border)",
          borderRadius: 12,
          padding: 14,
          background: "var(--atlas-surface)",
        }}
      >
        <div
          style={{
            color: "var(--atlas-gold)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Saved Connections
        </div>

        {loadingConnections ? (
          <div style={{ color: "var(--atlas-muted)", fontSize: 11 }}>Loading connections...</div>
        ) : connections.length === 0 ? (
          <div style={{ color: "var(--atlas-muted)", fontSize: 11 }}>No MCP servers connected yet</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {connections.map((connection) => {
              const tools = normalizeTools(connection.tools);
              const expanded = expandedIds.has(connection.id);

              return (
                <div
                  key={connection.id}
                  style={{
                    border: "1px solid var(--atlas-border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: "var(--atlas-surface)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleConnection(connection.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: 8,
                      padding: 0,
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                      fontFamily: "var(--app-font-mono)",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: "var(--atlas-fg)", fontSize: 12, marginBottom: 4 }}>
                          {connection.label}
                        </div>
                        <div style={{ color: "var(--atlas-muted)", fontSize: 11, overflowWrap: "anywhere" }}>
                          {connection.url}
                        </div>
                      </div>
                      <div style={{ color: "var(--atlas-muted)", fontSize: 11 }}>
                        {expanded ? "Hide" : "Show"}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--atlas-muted)", fontSize: 11 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: "var(--atlas-phosphor)",
                            boxShadow: "0 0 8px var(--atlas-phosphor)",
                          }}
                        />
                        Connected
                      </span>
                      <span>{tools.length} tools available</span>
                    </div>
                  </button>

                  {expanded && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                      {tools.map((tool) => (
                        <div key={tool.name}>
                          <div style={{ color: "var(--atlas-fg)", fontSize: 11 }}>{tool.name}</div>
                          {tool.description && (
                            <div style={{ color: "var(--atlas-muted)", fontSize: 10, marginTop: 2 }}>
                              {tool.description}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleDelete(connection.id)}
                    style={{ ...secondaryButtonStyle, marginTop: 10 }}
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
