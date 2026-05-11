import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useUpdateProject } from "@workspace/api-client-react";
import type { Project } from "@workspace/api-client-react";

interface Props {
  project: Project;
  onClose: () => void;
  onSaved?: () => void;
}

export function ProjectSettingsPanel({ project, onClose, onSaved }: Props) {
  const [name, setName] = useState(project.name ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [previewUrl, setPreviewUrl] = useState(project.previewUrl ?? "");
  const [saved, setSaved] = useState(false);
  const updateProject = useUpdateProject();

  useEffect(() => {
    setName(project.name ?? "");
    setDescription(project.description ?? "");
    setPreviewUrl(project.previewUrl ?? "");
  }, [project.id]);

  const handleSave = () => {
    updateProject.mutate(
      { id: project.id, data: { name: name.trim() || project.name, description: description || undefined, previewUrl: previewUrl.trim() || null } },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => { setSaved(false); onSaved?.(); onClose(); }, 800);
        },
      }
    );
  };

  const field: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--atlas-border)",
    background: "var(--atlas-surface-alt)",
    color: "var(--atlas-fg)",
    fontSize: 13,
    fontFamily: "var(--app-font-sans)",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 160ms",
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)", zIndex: 190 }} />
      <aside
        style={{
          position: "fixed", top: 0, right: 0,
          width: "min(92vw, 340px)",
          height: "100dvh",
          background: "var(--atlas-surface)",
          borderLeft: "1px solid var(--atlas-gold-border)",
          boxShadow: "-8px 0 40px -8px rgba(0,0,0,0.6)",
          zIndex: 191,
          display: "flex", flexDirection: "column",
          animation: "atlas-settings-in 200ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* Header */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 14px", borderBottom: "1px solid var(--atlas-gold-border)", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)" }}>Project Settings</div>
            <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", marginTop: 2, letterSpacing: "0.08em", opacity: 0.6 }}>
              {project.name}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "none", background: "transparent", color: "var(--atlas-muted)", cursor: "pointer" }}>
            <X size={15} strokeWidth={1.6} />
          </button>
        </header>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Name */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-muted)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "var(--app-font-mono)" }}>
                Project Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                style={field}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.5)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                placeholder="Project name"
                maxLength={120}
              />
            </div>

            {/* Preview URL */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-muted)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "var(--app-font-mono)" }}>
                Live URL
              </label>
              <input
                value={previewUrl}
                onChange={(e) => setPreviewUrl(e.target.value)}
                style={field}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.5)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                placeholder="https://yourapp.com"
                type="url"
              />
              <span style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.55, lineHeight: 1.4 }}>
                Paste your deployed app URL — the project card will show a live screenshot.
              </span>
            </div>

            {/* Description */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-muted)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "var(--app-font-mono)" }}>
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                style={{ ...field, resize: "vertical", lineHeight: 1.5 }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.5)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                placeholder="What is this project about?"
                maxLength={500}
              />
            </div>

            {/* Meta */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px", borderRadius: 8, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)" }}>Project ID</span>
                <span style={{ fontSize: 11, color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)", opacity: 0.7 }}>#{project.id}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)" }}>Created</span>
                <span style={{ fontSize: 11, color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)", opacity: 0.7 }}>
                  {new Date(project.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
              {project.linkedRepo && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", flexShrink: 0 }}>Repo</span>
                  <span style={{ fontSize: 11, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(() => {
                      try {
                        const r = JSON.parse(project.linkedRepo);
                        return typeof r === "string" ? r : (r.fullName ?? project.linkedRepo);
                      } catch { return project.linkedRepo; }
                    })()}
                  </span>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Footer */}
        <footer style={{ flexShrink: 0, padding: "12px 16px calc(env(safe-area-inset-bottom,0px) + 12px)", borderTop: "1px solid var(--atlas-gold-border)", display: "flex", gap: 8 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid var(--atlas-border)", background: "transparent", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 13, fontFamily: "var(--app-font-sans)" }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={updateProject.isPending || saved}
            style={{ flex: 2, padding: "9px 0", borderRadius: 8, border: `1px solid ${saved ? "rgba(34,197,94,0.3)" : "rgba(201,162,76,0.35)"}`, background: saved ? "rgba(34,197,94,0.15)" : "rgba(201,162,76,0.15)", color: saved ? "#86efac" : "var(--atlas-gold)", cursor: updateProject.isPending ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--app-font-sans)", transition: "all 200ms" }}
          >
            {saved ? "Saved ✓" : updateProject.isPending ? "Saving…" : "Save Changes"}
          </button>
        </footer>
      </aside>

      <style>{`
        @keyframes atlas-settings-in {
          from { transform: translateX(14px); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
