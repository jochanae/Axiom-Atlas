/**
 * ProjectDnaEditor — self-contained editor for project.shape (Identity /
 * Constraints / Format) + "Copy Strategic Payload" action.
 *
 * Extracted verbatim from TheForge.tsx so the behavior is identical:
 *   • Hydrates from GET /api/projects/{id} when initialShape is not provided
 *   • PUT /api/projects/{id}/shape on save, free-form shape
 *   • Same copy text, same pill chrome, same three cards
 *
 * variant controls density only — same logic everywhere it mounts.
 */

import { useEffect, useState, type CSSProperties } from "react";
import { haptics } from "@/lib/haptics";

type Shape = Record<string, unknown>;

interface Props {
  projectId: number;
  initialShape?: Shape;
  onShapeChange?: (shape: Shape) => void;
  variant?: "drawer" | "inline" | "modal";
}

const DNA_KEYS = [
  {
    key: "identity" as const,
    label: "Identity",
    subtitle: "Who you are and what you're building",
    placeholder: "Define your core persona, vision, and strategic context",
    addLabel: "+ Add Identity",
    editLabel: "Edit Identity",
  },
  {
    key: "constraints" as const,
    label: "Constraints",
    subtitle: "The boundaries the AI must respect",
    placeholder: "Add financial, stylistic, or technical constraints",
    addLabel: "+ Add Constraint",
    editLabel: "Edit Constraint",
  },
  {
    key: "format" as const,
    label: "Format",
    subtitle: "How you want intelligence packaged",
    placeholder: "Define your preferred output structure and style",
    addLabel: "+ Add Format",
    editLabel: "Edit Format",
  },
];

export function ProjectDnaEditor({
  projectId,
  initialShape,
  onShapeChange,
  variant = "drawer",
}: Props) {
  const [projectShape, setProjectShape] = useState<Shape>(initialShape ?? {});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Hydrate from backend when no initial shape was handed in
  useEffect(() => {
    if (initialShape !== undefined) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((proj: { shape?: Shape | null } | null) => {
        if (cancelled) return;
        if (proj?.shape && typeof proj.shape === "object") {
          setProjectShape(proj.shape);
        }
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [projectId, initialShape]);

  const dnaValue = (key: string): string => {
    const v = projectShape[key];
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join("\n");
    return "";
  };

  const startEdit = (key: string) => {
    setError(null);
    setDraft(dnaValue(key));
    setEditingKey(key);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setDraft("");
    setError(null);
  };

  const save = async () => {
    if (!projectId || !editingKey) return;
    setSaving(true);
    setError(null);
    const key = editingKey;
    const nextShape: Shape = { ...projectShape, [key]: draft };
    try {
      const r = await fetch(`/api/projects/${projectId}/shape`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shape: nextShape }),
      });
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
      const data = (await r.json().catch(() => null)) as { shape?: Shape } | null;
      const resolved = data?.shape && typeof data.shape === "object" ? data.shape : nextShape;
      setProjectShape(resolved);
      onShapeChange?.(resolved);
      setEditingKey(null);
      setDraft("");
      haptics.tap();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const copyStrategicPayload = async () => {
    const parts: string[] = [];
    const id = dnaValue("identity");
    const co = dnaValue("constraints");
    const fmt = dnaValue("format");
    if (id) parts.push(`# Identity\n${id}`);
    if (co) parts.push(`# Constraints\n${co}`);
    if (fmt) parts.push(`# Format\n${fmt}`);
    const payload = parts.join("\n\n") || "(No Project DNA defined yet)";
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      haptics.tap();
      setTimeout(() => setCopied(false), 1600);
    } catch { /* silent */ }
  };

  const pillBtn: CSSProperties = {
    alignSelf: "flex-start",
    padding: "6px 14px",
    borderRadius: 20,
    border: "1px solid rgba(var(--atlas-gold-rgb),0.25)",
    background: "rgba(var(--atlas-gold-rgb),0.02)",
    color: "rgba(var(--atlas-gold-rgb),0.75)",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "var(--app-font-mono)",
    letterSpacing: "0.08em",
    cursor: "pointer",
    textTransform: "uppercase",
  };

  const cardPadding = variant === "inline" ? "12px 14px" : "14px 16px";
  const gap = variant === "inline" ? 12 : 14;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {DNA_KEYS.map(({ key, label, subtitle, placeholder, addLabel, editLabel }) => {
        const value = dnaValue(key);
        const isEditing = editingKey === key;
        return (
          <div
            key={key}
            style={{
              borderRadius: 12,
              border: "1px solid rgba(var(--atlas-gold-rgb),0.12)",
              background: "rgba(255,255,255,0.02)",
              backdropFilter: "blur(8px)",
              padding: cardPadding,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.15em",
                  color: "var(--atlas-gold)",
                  textTransform: "uppercase",
                  fontFamily: "var(--app-font-mono)",
                }}
              >
                {label}
              </span>
              <span style={{ fontSize: 11, color: "rgba(var(--atlas-muted-rgb),0.6)", lineHeight: 1.4 }}>
                {subtitle}
              </span>
            </div>
            {isEditing ? (
              <>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={placeholder}
                  autoFocus
                  rows={4}
                  style={{
                    width: "100%",
                    resize: "vertical",
                    minHeight: 80,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(var(--atlas-gold-rgb),0.3)",
                    background: "rgba(0,0,0,0.25)",
                    color: "rgba(var(--atlas-muted-rgb),0.95)",
                    fontSize: 12,
                    lineHeight: 1.5,
                    fontFamily: "var(--app-font-sans)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                {error && <span style={{ fontSize: 11, color: "rgba(239,68,68,0.9)" }}>{error}</span>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={save}
                    disabled={saving || !projectId}
                    style={{ ...pillBtn, opacity: saving ? 0.5 : 1 }}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={saving}
                    style={{
                      ...pillBtn,
                      borderColor: "rgba(var(--atlas-muted-rgb),0.25)",
                      color: "rgba(var(--atlas-muted-rgb),0.65)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {value ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: "rgba(var(--atlas-muted-rgb),0.85)",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {value}
                  </p>
                ) : (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: "rgba(var(--atlas-muted-rgb),0.45)",
                      lineHeight: 1.5,
                      fontStyle: "italic",
                    }}
                  >
                    {placeholder}
                  </p>
                )}
                <button
                  onClick={() => startEdit(key)}
                  disabled={!projectId}
                  style={{ ...pillBtn, opacity: projectId ? 1 : 0.4 }}
                >
                  {value ? editLabel : addLabel}
                </button>
              </>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", justifyContent: "center", paddingTop: 4 }}>
        <button
          onClick={copyStrategicPayload}
          style={{
            padding: "7px 18px",
            borderRadius: 20,
            border: "1px solid rgba(var(--atlas-muted-rgb),0.2)",
            background: "rgba(var(--atlas-muted-rgb),0.08)",
            color: "rgba(var(--atlas-muted-rgb),0.55)",
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.08em",
            cursor: "pointer",
            textTransform: "uppercase",
            transition: "all 180ms",
          }}
        >
          {copied ? "Copied ✓" : "Copy Strategic Payload →"}
        </button>
      </div>
    </div>
  );
}

export default ProjectDnaEditor;
