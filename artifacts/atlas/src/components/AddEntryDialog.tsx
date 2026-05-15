import { useState } from "react";
import { useCreateEntry } from "@workspace/api-client-react";
import type { Project } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListEntriesQueryKey } from "@workspace/api-client-react";
import { extractApiErrorMessage } from "../lib/atlas-utils";

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: number;
  projects?: Project[];
  onCreated?: () => void;
};

export function AddEntryDialog({ open, onClose, projectId, onCreated }: Props) {
  const queryClient = useQueryClient();
  const createEntry = useCreateEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId) });
      },
    },
  });

  const [title, setTitle] = useState("");
  const [violation, setViolation] = useState(false);
  const [cost, setCost] = useState("");
  const [description, setDescription] = useState("");
  const [apiError, setApiError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setTitle("");
    setViolation(false);
    setCost("");
    setDescription("");
    setApiError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setApiError(null);

    try {
      await createEntry.mutateAsync({
        projectId,
        data: {
          status: "committed",
          title: title.trim(),
          summary: description.trim() || null,
          severity: violation ? "blocker" : "committed",
          verb: violation ? "audit" : "note",
          costOfLesson: cost ? Number(cost) : null,
        },
      });
      reset();
      onCreated?.();
      onClose();
    } catch (err) {
      setApiError(extractApiErrorMessage(err));
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", background: "rgba(0,0,0,0.70)", backdropFilter: "blur(4px)", paddingTop: 96, padding: "96px 16px 0" }}
      onClick={onClose}
    >
      <div
        style={{ width: "100%", maxWidth: 576, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 500, letterSpacing: "-0.01em", margin: 0 }}>New Ledger Entry</h2>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-text)", margin: "2px 0 0", letterSpacing: "0.06em" }}>
              Commit Mode · permanent record
            </p>
          </div>
          <button onClick={onClose} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-text)", background: "transparent", border: "none", cursor: "pointer", letterSpacing: "0.1em" }}>
            ESC
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Decision Title">
            <input
              autoFocus
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (apiError) setApiError(null); }}
              placeholder="e.g. Use UUID primary keys across all tables"
              style={inputStyle}
            />
            {apiError && (
              <div style={{
                marginTop: 6, padding: "6px 10px", borderRadius: 3, fontSize: 11,
                background: "color-mix(in srgb, var(--ember, #dc2626) 10%, transparent)",
                border: "0.5px solid color-mix(in srgb, var(--ember, #dc2626) 35%, transparent)",
                color: "var(--ember, #dc2626)",
                fontFamily: "var(--font-mono)",
              }}>
                {apiError}
              </div>
            )}
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Mark as direction shift?" hint="check if this overrides a prior commitment">
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36 }}>
                <input
                  type="checkbox"
                  checked={violation}
                  onChange={(e) => setViolation(e.target.checked)}
                  style={{ accentColor: "var(--ember)" }}
                />
                <span style={{ fontSize: 12, color: "var(--muted-text)" }}>
                  {violation ? "Logged as override" : "Standard commit"}
                </span>
              </label>
            </Field>
            <Field label="Cost of Lesson (USD)" hint="optional">
              <input
                type="number"
                step="any"
                min="0"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="—"
                style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
              />
            </Field>
          </div>

          <Field label="Notes / Rationale">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Why this decision was made. What it prevents."
              style={{ ...inputStyle, resize: "none" as const }}
            />
          </Field>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <button type="button" onClick={onClose} style={{ padding: "6px 12px", fontSize: 11, color: "var(--muted-text)", background: "transparent", border: "none", cursor: "pointer" }}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={createEntry.isPending || !title.trim()}
              style={{ padding: "7px 16px", fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" as const, background: "var(--ember)", color: "var(--background)", border: "none", borderRadius: 4, cursor: createEntry.isPending || !title.trim() ? "default" : "pointer", opacity: createEntry.isPending || !title.trim() ? 0.5 : 1 }}
            >
              {createEntry.isPending ? "Logging…" : "Commit Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--background)",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  padding: "8px 10px",
  fontSize: 13,
  outline: "none",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--muted-text)", marginBottom: 6 }}>
        {label}
        {hint && <span style={{ textTransform: "none" as const, letterSpacing: "normal", fontSize: 9.5, opacity: 0.65 }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}
