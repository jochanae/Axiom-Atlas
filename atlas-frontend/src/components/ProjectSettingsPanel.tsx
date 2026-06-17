import { useState, useEffect } from "react";
import { Project, UpdateProjectBody, updateProject, useUpdateProject } from "@workspace/api-client-react";
import { X } from "lucide-react";
import { parseLinkedRepo, serializeLinkedRepo } from "@/lib/githubRepo";
import { ProjectDnaEditor } from "@/components/ProjectDnaEditor";

interface Props {
  project: Project;
  onClose: () => void;
  onSaved?: () => void;
}

type ProjectWithLinkedRepos = Project & { linkedRepos?: string | null };
type UpdateProjectBodyWithLinkedRepos = UpdateProjectBody & { linkedRepos: string };

const REPO_NAME_PATTERN = /^[^/]+\/[^/]+$/;

function repoNameFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (value && typeof value === "object" && "fullName" in value) {
    const fullName = (value as { fullName?: unknown }).fullName;
    return typeof fullName === "string" && fullName.trim() ? fullName.trim() : null;
  }

  return null;
}

function parseLinkedRepoValue(linkedRepo?: string | null): string | null {
  return parseLinkedRepo(linkedRepo)?.fullName ?? null;
}

function parseLinkedRepos(project: Project): string[] {
  const projectWithRepos = project as ProjectWithLinkedRepos;
  const repos: string[] = [];

  const addRepo = (repo: string | null) => {
    if (!repo || repos.includes(repo)) return;
    repos.push(repo);
  };

  if (projectWithRepos.linkedRepos) {
    try {
      const parsed = JSON.parse(projectWithRepos.linkedRepos);
      if (Array.isArray(parsed)) {
        parsed.forEach((repo) => addRepo(repoNameFromValue(repo)));
      } else {
        addRepo(repoNameFromValue(parsed));
      }
    } catch {}
  }

  if (repos.length === 0) {
    addRepo(parseLinkedRepoValue(project.linkedRepo));
  }

  return repos;
}

function linkedRepoPayloadFor(repoName: string, project: Project): string {
  if (parseLinkedRepoValue(project.linkedRepo) === repoName && project.linkedRepo) {
    return project.linkedRepo;
  }

  return serializeLinkedRepo({
    fullName: repoName,
    defaultBranch: "main",
    name: repoName.split("/")[1] ?? repoName,
  });
}

export function ProjectSettingsPanel({ project, onClose, onSaved }: Props) {
  const [name, setName] = useState(project.name ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [previewUrl, setPreviewUrl] = useState(project.previewUrl ?? "");
  const [linkedRepos, setLinkedRepos] = useState(() => parseLinkedRepos(project));
  const [repoInput, setRepoInput] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const updateProject = useUpdateProject();

  useEffect(() => {
    setName(project.name ?? "");
    setDescription(project.description ?? "");
    setPreviewUrl(project.previewUrl ?? "");
    setLinkedRepos(parseLinkedRepos(project));
    setRepoInput("");
    setRepoError(null);
  }, [project.id]);

  const handleAddRepo = () => {
    const nextRepo = repoInput.trim();

    if (!REPO_NAME_PATTERN.test(nextRepo)) {
      setRepoError("Use owner/repo-name format.");
      return;
    }

    if (linkedRepos.includes(nextRepo)) {
      setRepoError("Repo already added.");
      return;
    }

    setLinkedRepos((repos) => [...repos, nextRepo]);
    setRepoInput("");
    setRepoError(null);
  };

  const handleRemoveRepo = (repo: string) => {
    setLinkedRepos((repos) => repos.filter((currentRepo) => currentRepo !== repo));
    setRepoError(null);
  };

  const isBuilt = (project as any).status === "built";
  const handleMarkBuilt = () => {
    if (isBuilt) return;
    updateProject.mutate(
      { id: project.id, data: { status: "built" } as any },
      {
        onSuccess: () => {
          onSaved?.();
        },
      }
    );
  };

  const handleSave = () => {
    const primaryRepo = linkedRepos[0] ?? null;
    const data: UpdateProjectBodyWithLinkedRepos = {
      name: name.trim() || project.name,
      description: description || undefined,
      previewUrl: previewUrl.trim() || null,
      linkedRepos: JSON.stringify(linkedRepos),
      linkedRepo: primaryRepo ? linkedRepoPayloadFor(primaryRepo, project) : null,
    };

    updateProject.mutate(
      { id: project.id, data },
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
          width: "min(94vw, 420px)",
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

            {/* Project DNA — identity, constraints, format. Persists to project.shape. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-muted)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "var(--app-font-mono)" }}>
                  Project DNA
                </label>
                <span style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-sans)", opacity: 0.6, lineHeight: 1.45 }}>
                  Identity, constraints, and output format — sharpens every AI response across the project.
                </span>
              </div>
              <ProjectDnaEditor
                projectId={project.id}
                initialShape={(project as { shape?: Record<string, unknown> }).shape ?? undefined}
                variant="drawer"
              />
            </div>


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
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)" }}>Repos</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {linkedRepos.length > 0 ? (
                    linkedRepos.map((repo, index) => (
                      <div key={repo} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {repo}
                        </span>
                        {index === 0 && (
                          <span style={{ fontSize: 9, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", opacity: 0.55 }}>
                            PRIMARY
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveRepo(repo)}
                          aria-label={`Remove ${repo}`}
                          style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid var(--atlas-border)", background: "transparent", color: "var(--atlas-muted)", cursor: "pointer", flexShrink: 0 }}
                        >
                          <X size={11} strokeWidth={1.8} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <span style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.55 }}>
                      No repos linked.
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={repoInput}
                    onChange={(e) => { setRepoInput(e.target.value); setRepoError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddRepo(); } }}
                    style={{ ...field, padding: "8px 10px", fontSize: 11 }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.5)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                    placeholder="owner/repo-name"
                    aria-label="Add repo"
                  />
                  <button
                    type="button"
                    onClick={handleAddRepo}
                    style={{ padding: "0 12px", borderRadius: 8, border: "1px solid rgba(201,162,76,0.35)", background: "rgba(201,162,76,0.15)", color: "var(--atlas-gold)", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "var(--app-font-sans)" }}
                  >
                    Add
                  </button>
                </div>
                {repoError && (
                  <span style={{ fontSize: 10, color: "#fca5a5", fontFamily: "var(--app-font-mono)", opacity: 0.85 }}>
                    {repoError}
                  </span>
                )}
              </div>
            </div>

          </div>

          {/* Lifecycle — user-confirmed "Built" transition */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--atlas-border)" }}>
            <div style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.7, marginBottom: 8 }}>
              Lifecycle
            </div>
            <button
              type="button"
              onClick={handleMarkBuilt}
              disabled={isBuilt || updateProject.isPending}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${isBuilt ? "rgba(120,180,160,0.55)" : "rgba(201,162,76,0.35)"}`,
                background: isBuilt ? "rgba(120,180,160,0.16)" : "rgba(201,162,76,0.10)",
                color: isBuilt ? "rgba(180,220,200,0.95)" : "var(--atlas-gold)",
                cursor: isBuilt || updateProject.isPending ? "default" : "pointer",
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: "var(--app-font-sans)",
              }}
            >
              {isBuilt ? "✓ Built" : updateProject.isPending ? "Saving…" : "Mark as Built"}
            </button>
            <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.6, fontFamily: "var(--app-font-mono)", lineHeight: 1.5 }}>
              Marks this project as complete and successful. Distinct from archived.
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
