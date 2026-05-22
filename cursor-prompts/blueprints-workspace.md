# Workspace — Blueprints Tab

## Context
The backend routes are live:
- `GET  /api/projects/:id/blueprints` → returns an array of `{ id, title, content, createdAt }`
- `POST /api/projects/:id/blueprint`  → generates a new blueprint from the project's idea-mode session, returns `{ id, title, content, createdAt }`

Blueprint `content` shape:
```ts
{
  title: string;
  idea: string;
  opportunity: string;
  mechanism: string;
  landscape: string;
  risks: string[];
  openQuestions: string[];
  nextSteps: string[];
  visualPrompt: string;
}
```

The generate endpoint reads the most recent session where `ideaMode: true` for the project.
If none exists it returns `400 { error: "No idea mode session found for this project" }`.

This prompt adds a **Blueprints** tab to the workspace right pane alongside Ledger, Files, Preview, Memory, Flow.

---

## File to change
`src/pages/workspace.tsx`

---

## Step 1 — Extend the `RightTab` type

Find this line near the very top of the file (around line 154):

```ts
type RightTab = "ledger" | "files" | "preview" | "memory" | "map" | "terminal";
```

Replace with:

```ts
type RightTab = "ledger" | "files" | "preview" | "memory" | "map" | "terminal" | "blueprints";
```

---

## Step 2 — Add the tab button to the desktop right-pane tab list

Find the `tabs` array inside the right-pane component (look for `const tabs: { id: RightTab; label: string; icon: React.ReactNode; badge?: number }[] = [`). Inside that array, find the `"memory"` entry — it looks like:

```ts
    {
      id: "memory" as RightTab,
      label: "Memory",
      icon: (
```

Add this new entry **immediately after** the closing `},` of the `"memory"` object (before the `"map"` entry):

```ts
    {
      id: "blueprints" as RightTab,
      label: "Blueprints",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M2 2h8l3 3v9H2V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M4 7h6M4 9.5h6M4 12h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      ),
    },
```

---

## Step 3 — Render the tab content

Find this block (around line 7169) where all tab panels are conditionally rendered:

```tsx
      {tab === "files" && <FilesTab projectId={projectId} onFileContext={onFileContext} onLinkedRepoChange={onLinkedRepoChange} />}
      {tab === "preview" && <PreviewTab ...
```

Add this line immediately **before** the `{tab === "files" && ...}` line:

```tsx
      {tab === "blueprints" && <BlueprintsTab projectId={projectId} />}
```

---

## Step 4 — Add the `BlueprintsTab` component

Add this entire component near the bottom of the file, just before the final `export default` statement:

```tsx
// ── BlueprintsTab ─────────────────────────────────────────────────────────────
type BlueprintContent = {
  title: string;
  idea: string;
  opportunity: string;
  mechanism: string;
  landscape: string;
  risks: string[];
  openQuestions: string[];
  nextSteps: string[];
  visualPrompt: string;
};

type Blueprint = {
  id: number;
  title: string;
  content: BlueprintContent;
  createdAt: string;
};

function BlueprintsTab({ projectId }: { projectId: number }) {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetchBlueprints = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/blueprints`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as Blueprint[];
        setBlueprints(data);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchBlueprints(); }, [projectId]);

  const generate = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/blueprint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setGenError(data.error ?? `Error ${res.status}`);
        return;
      }
      const blueprint = await res.json() as Blueprint;
      setBlueprints((prev) => [blueprint, ...prev]);
      setExpanded(blueprint.id);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  };

  const monoLabel: React.CSSProperties = {
    fontFamily: "var(--app-font-mono)",
    fontSize: 8.5,
    letterSpacing: "0.13em",
    color: "var(--atlas-muted)",
    opacity: 0.65,
    textTransform: "uppercase",
    display: "block",
    marginBottom: 5,
  };

  const section = (label: string, value: string) => (
    <div style={{ marginBottom: 14 }}>
      <span style={monoLabel}>{label}</span>
      <p style={{ fontSize: 13, color: "var(--atlas-fg)", lineHeight: 1.65, margin: 0, opacity: 0.9 }}>{value}</p>
    </div>
  );

  const listSection = (label: string, items: string[]) => (
    <div style={{ marginBottom: 14 }}>
      <span style={monoLabel}>{label}</span>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {items.map((item, i) => (
          <li key={i} style={{ fontSize: 13, color: "var(--atlas-fg)", lineHeight: 1.65, marginBottom: 3, opacity: 0.9 }}>{item}</li>
        ))}
      </ul>
    </div>
  );

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--atlas-muted)", fontSize: 12, opacity: 0.5 }}>
        Loading blueprints…
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em" }}>Blueprints</div>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.55, marginTop: 2 }}>
              {blueprints.length} saved
            </div>
          </div>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            style={{
              padding: "7px 13px",
              borderRadius: 7,
              background: generating ? "var(--atlas-border)" : "var(--atlas-gold)",
              color: generating ? "var(--atlas-muted)" : "#0D0B09",
              fontSize: 11.5,
              fontWeight: 700,
              border: "none",
              cursor: generating ? "default" : "pointer",
              flexShrink: 0,
              transition: "background 140ms",
              letterSpacing: "-0.01em",
            }}
          >
            {generating ? "Generating…" : "+ Generate"}
          </button>
        </div>

        {genError && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "color-mix(in oklab, var(--atlas-ember) 8%, transparent)", border: "1px solid rgba(146,64,14,0.25)" }}>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-ember)", opacity: 0.9, lineHeight: 1.5 }}>
              {genError === "No idea mode session found for this project"
                ? "No idea-mode conversation found. Start an idea chat on the home page with this project in focus, then generate here."
                : genError}
            </div>
          </div>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 80px" }}>
        {blueprints.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--atlas-muted)", opacity: 0.45 }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>No blueprints yet</div>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, lineHeight: 1.6 }}>
              Explore an idea on the home page with this project in focus, then hit Generate above.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {blueprints.map((bp) => (
              <div key={bp.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === bp.id ? null : bp.id)}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 9,
                    background: expanded === bp.id
                      ? "color-mix(in oklab, var(--atlas-gold) 7%, var(--atlas-surface))"
                      : "var(--atlas-surface)",
                    border: `1px solid ${expanded === bp.id ? "rgba(201,162,76,0.3)" : "var(--atlas-border)"}`,
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                    transition: "border-color 140ms, background 140ms",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em", marginBottom: 3 }}>{bp.content.title}</div>
                    <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.55 }}>
                      {new Date(bp.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  </div>
                  <svg
                    width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                    style={{ color: "var(--atlas-muted)", opacity: 0.4, flexShrink: 0, marginTop: 3, transform: expanded === bp.id ? "rotate(90deg)" : "none", transition: "transform 180ms" }}
                  >
                    <path d="M4 2l4 4-4 4" />
                  </svg>
                </button>

                {expanded === bp.id && (
                  <div style={{ padding: "14px", background: "var(--atlas-surface)", borderRadius: "0 0 9px 9px", borderTop: "none", border: "1px solid rgba(201,162,76,0.2)", borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: -1 }}>
                    {section("The Idea", bp.content.idea)}
                    {section("Opportunity", bp.content.opportunity)}
                    {section("How It Works", bp.content.mechanism)}
                    {section("Landscape", bp.content.landscape)}
                    {listSection("Risks", bp.content.risks)}
                    {listSection("Open Questions", bp.content.openQuestions)}
                    {listSection("Next Steps", bp.content.nextSteps)}
                    {bp.content.visualPrompt && section("Visual", bp.content.visualPrompt)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## Step 5 — Run typecheck and push

```
pnpm --filter @workspace/atlas run typecheck
```

Fix any errors, then push to main.

---

## What this does

- Adds a **Blueprints** tab to the workspace right pane (alongside Ledger, Files, Preview, Memory, Flow)
- On open: loads all existing blueprints for the project from the DB
- **+ Generate** button: calls the backend to crystallize the most recent idea-mode conversation into a structured blueprint document (Claude does the analysis — takes 3–6 seconds)
- If no idea-mode session exists: shows a plain-language message explaining what to do first
- Click any blueprint row to expand all 9 sections inline (idea, opportunity, mechanism, landscape, risks, open questions, next steps, visual prompt)
- Click again to collapse
- Newest blueprint auto-expands after generation
- All design tokens match the workspace exactly (atlas-gold, atlas-surface, atlas-border, atlas-ember, atlas-muted, mono labels)
