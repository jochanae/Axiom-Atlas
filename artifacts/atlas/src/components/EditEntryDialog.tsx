import { useState, useEffect, useRef } from "react";
import type { Entry } from "@workspace/api-client-react";
import type React from "react";

type EditableFields = {
  title: string;
  summary: string;
  details: string;
  buildId: string;
  touched: string[];
  costOfLesson: string;
};

type SaveData = {
  title: string;
  summary: string | null;
  details: string | null;
  buildId: string | null;
  touched: string[] | null;
  costOfLesson: number | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  entry: Entry | null;
  onSave: (id: number, data: SaveData) => Promise<void>;
  saving?: boolean;
};

function fieldsEqual(a: EditableFields, b: EditableFields): boolean {
  return (
    a.title === b.title &&
    a.summary === b.summary &&
    a.details === b.details &&
    a.buildId === b.buildId &&
    a.costOfLesson === b.costOfLesson &&
    a.touched.length === b.touched.length &&
    a.touched.every((t, i) => t === b.touched[i])
  );
}

export function EditEntryDialog({ open, onClose, entry, onSave, saving = false }: Props) {
  const [fields, setFields] = useState<EditableFields>({ title: "", summary: "", details: "", buildId: "", touched: [], costOfLesson: "" });
  const [initialFields, setInitialFields] = useState<EditableFields>({ title: "", summary: "", details: "", buildId: "", touched: [], costOfLesson: "" });
  const [tagInput, setTagInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const tagInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Stable ref so the ESC keydown listener always calls the latest handleAttemptClose
  const handleAttemptCloseRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleAttemptCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (entry) {
      const initial: EditableFields = {
        title: entry.title ?? "",
        summary: entry.summary ?? "",
        details: entry.details ?? "",
        buildId: entry.buildId ?? "",
        touched: entry.touched ?? [],
        costOfLesson: entry.costOfLesson != null ? String(entry.costOfLesson) : "",
      };
      setFields(initial);
      setInitialFields(initial);
      setTagInput("");
      setSaveError(null);
      setShowDiscardConfirm(false);
    }
  }, [entry]);

  if (!open || !entry) return null;

  const isDirty = !fieldsEqual(fields, initialFields);

  const handleAttemptClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  // Keep ref in sync with latest closure on every render
  handleAttemptCloseRef.current = handleAttemptClose;

  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false);
    onClose();
  };

  const handleCancelDiscard = () => {
    setShowDiscardConfirm(false);
    // Return focus to the title field so the user can continue editing
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const addTag = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const parts = value.split(/[\s,]+/).filter(Boolean);
    const next = [...fields.touched];
    for (const p of parts) {
      if (!next.includes(p)) next.push(p);
    }
    setFields((f) => ({ ...f, touched: next }));
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setFields((f) => ({ ...f, touched: f.touched.filter((t) => t !== tag) }));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && !tagInput && fields.touched.length > 0) {
      setFields((f) => ({ ...f, touched: f.touched.slice(0, -1) }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaveError(null);
    const trimmedTitle = fields.title.trim();
    if (!trimmedTitle) {
      setSaveError("Title is required.");
      return;
    }
    const parsedCost = fields.costOfLesson !== "" ? Number(fields.costOfLesson) : null;
    if (parsedCost !== null && isNaN(parsedCost)) {
      setSaveError("Cost of Lesson must be a valid number.");
      return;
    }
    try {
      await onSave(entry.id, {
        title: trimmedTitle,
        summary: fields.summary.trim() || null,
        details: fields.details.trim() || null,
        buildId: fields.buildId.trim() || null,
        touched: fields.touched.length > 0 ? fields.touched : null,
        costOfLesson: parsedCost,
      });
      onClose();
    } catch {
      setSaveError("Failed to save changes. Please try again.");
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleAttemptClose();
  };

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        background: "rgba(0,0,0,0.72)", backdropFilter: "blur(5px)",
        padding: "80px 16px 24px",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: 560,
          background: "var(--atlas-surface, var(--surface))",
          border: "1px solid var(--atlas-border, var(--border))",
          borderRadius: 8,
          boxShadow: "0 32px 80px rgba(0,0,0,0.55)",
          flexShrink: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--atlas-border, var(--border))",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: "var(--app-font-mono, var(--font-mono))",
              fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
              color: "var(--atlas-muted, var(--muted-text))", marginBottom: 4,
            }}>
              Edit Entry · <span style={{ opacity: 0.6 }}>#{entry.id}</span>
            </div>
            <h2 style={{
              margin: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.35,
              color: "var(--atlas-fg, var(--foreground))", letterSpacing: "-0.01em",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {entry.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleAttemptClose}
            style={{
              fontFamily: "var(--app-font-mono, var(--font-mono))", fontSize: 10,
              letterSpacing: "0.12em", textTransform: "uppercase",
              color: "var(--atlas-muted, var(--muted-text))", background: "transparent",
              border: "none", cursor: "pointer", padding: "4px 8px",
            }}
          >
            ESC
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Title */}
          <FormField label="Title" hint="required">
            <input
              ref={titleInputRef}
              value={fields.title}
              onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
              placeholder="Entry title…"
              style={inputStyle}
            />
          </FormField>

          {/* Summary */}
          <FormField label="Summary" hint="optional — one-line description">
            <input
              value={fields.summary}
              onChange={(e) => setFields((f) => ({ ...f, summary: e.target.value }))}
              placeholder="Brief summary…"
              style={inputStyle}
            />
          </FormField>

          {/* Build ID */}
          <FormField label="Build ID" hint="optional — e.g. v1.4.2 or commit sha">
            <input
              value={fields.buildId}
              onChange={(e) => setFields((f) => ({ ...f, buildId: e.target.value }))}
              placeholder="e.g. v2.1.0 or abc1234"
              style={inputStyle}
            />
          </FormField>

          {/* Cost of Lesson */}
          <FormField label="Cost of Lesson (USD)" hint="optional">
            <input
              type="number"
              step="any"
              min="0"
              value={fields.costOfLesson}
              onChange={(e) => setFields((f) => ({ ...f, costOfLesson: e.target.value }))}
              placeholder="—"
              style={{ ...inputStyle, fontFamily: "var(--app-font-mono, var(--font-mono))" }}
            />
          </FormField>

          {/* Details */}
          <FormField label="Details" hint="optional — extended notes, rationale, context">
            <textarea
              value={fields.details}
              onChange={(e) => setFields((f) => ({ ...f, details: e.target.value }))}
              rows={4}
              placeholder="Extended context, implementation notes, lessons learned…"
              style={{ ...inputStyle, resize: "none" }}
            />
          </FormField>

          {/* Touched files */}
          <FormField label="Touched Files" hint="press Enter or comma to add">
            <div
              onClick={() => tagInputRef.current?.focus()}
              style={{
                ...inputStyle,
                minHeight: 36,
                display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center",
                cursor: "text", padding: "6px 8px",
              }}
            >
              {fields.touched.map((tag) => (
                <span
                  key={tag}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontFamily: "var(--app-font-mono, var(--font-mono))",
                    fontSize: 10.5, padding: "2px 6px", borderRadius: 3,
                    background: "color-mix(in srgb, var(--atlas-gold, var(--accent-gold)) 12%, transparent)",
                    border: "0.5px solid color-mix(in srgb, var(--atlas-gold, var(--accent-gold)) 30%, transparent)",
                    color: "var(--atlas-gold, var(--accent-gold))",
                    lineHeight: 1.4,
                  }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                    style={{
                      background: "transparent", border: "none", cursor: "pointer",
                      color: "inherit", padding: 0, lineHeight: 1, fontSize: 11, opacity: 0.7,
                      display: "flex", alignItems: "center",
                    }}
                    aria-label={`Remove ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                ref={tagInputRef}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
                placeholder={fields.touched.length === 0 ? "src/components/Foo.tsx, lib/utils.ts…" : ""}
                style={{
                  flex: 1, minWidth: 80, background: "transparent", border: "none",
                  outline: "none", fontFamily: "var(--app-font-mono, var(--font-mono))",
                  fontSize: 11, color: "var(--atlas-fg, var(--foreground))",
                  padding: 0,
                }}
              />
            </div>
          </FormField>

          {/* Error message */}
          {saveError && (
            <div style={{
              padding: "8px 10px", borderRadius: 4, fontSize: 11,
              background: "color-mix(in srgb, var(--ember, #dc2626) 10%, transparent)",
              border: "0.5px solid color-mix(in srgb, var(--ember, #dc2626) 35%, transparent)",
              color: "var(--ember, #dc2626)",
              fontFamily: "var(--app-font-mono, var(--font-mono))",
            }}>
              {saveError}
            </div>
          )}

          {/* Discard confirmation */}
          {showDiscardConfirm && (
            <div style={{
              padding: "10px 12px", borderRadius: 4,
              background: "color-mix(in srgb, var(--atlas-gold, var(--accent-gold)) 8%, transparent)",
              border: "1px solid color-mix(in srgb, var(--atlas-gold, var(--accent-gold)) 30%, transparent)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}>
              <span style={{
                fontSize: 11, fontFamily: "var(--app-font-mono, var(--font-mono))",
                color: "var(--atlas-fg, var(--foreground))",
              }}>
                Discard unsaved changes?
              </span>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={handleCancelDiscard}
                  style={{
                    padding: "4px 12px", fontSize: 10,
                    fontFamily: "var(--app-font-mono, var(--font-mono))",
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    color: "var(--atlas-muted, var(--muted-text))",
                    background: "transparent",
                    border: "1px solid var(--atlas-border, var(--border))",
                    borderRadius: 3, cursor: "pointer",
                  }}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDiscard}
                  style={{
                    padding: "4px 12px", fontSize: 10,
                    fontFamily: "var(--app-font-mono, var(--font-mono))",
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    background: "var(--ember, #dc2626)",
                    color: "#fff",
                    border: "none", borderRadius: 3, cursor: "pointer",
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
            paddingTop: 10, borderTop: "1px solid var(--atlas-border, var(--border))",
          }}>
            <button
              type="button"
              onClick={handleAttemptClose}
              style={{
                padding: "6px 14px", fontSize: 10,
                fontFamily: "var(--app-font-mono, var(--font-mono))",
                letterSpacing: "0.1em", textTransform: "uppercase",
                color: "var(--atlas-muted, var(--muted-text))",
                background: "transparent", border: "none", cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "7px 18px", fontSize: 10, fontWeight: 600,
                fontFamily: "var(--app-font-mono, var(--font-mono))",
                letterSpacing: "0.1em", textTransform: "uppercase",
                background: "var(--atlas-gold, var(--accent-gold))",
                color: "var(--atlas-bg, var(--background))",
                border: "none", borderRadius: 4,
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.5 : 1,
                transition: "opacity 140ms ease",
              }}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--atlas-bg, var(--background))",
  color: "var(--atlas-fg, var(--foreground))",
  border: "1px solid var(--atlas-border, var(--border))",
  borderRadius: 4,
  padding: "8px 10px",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
};

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{
        display: "flex", alignItems: "baseline", gap: 7,
        fontFamily: "var(--app-font-mono, var(--font-mono))",
        fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
        color: "var(--atlas-muted, var(--muted-text))",
      }}>
        {label}
        {hint && <span style={{ textTransform: "none", letterSpacing: "normal", fontSize: 9.5, opacity: 0.6 }}>{hint}</span>}
      </span>
      {children}
    </div>
  );
}
