# Account-Level GitHub Connection (workspace.tsx + ConnectionsTab)

## What this fixes
GitHub tokens are currently saved per-project. The backend already supports an
account-level connection table that covers all projects automatically — but the
frontend never writes to it. This prompt wires the Connections tab to the account
endpoint so the user enters their token once and every project works.

---

## File to change
`src/pages/workspace.tsx`

---

## Step 1 — Find the ConnectionsTab component

Find the function named `ConnectionsTab` (or the component that renders inside the
Connections tab of the workspace right pane). It currently either saves a token to
`localStorage` as `atlas-github-token` or calls a per-project endpoint.

---

## Step 2 — Replace token save with account-level POST

Find the submit / save handler inside ConnectionsTab where the token is saved.
Replace whatever it does with this:

```ts
const res = await fetch("/api/connections", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "github", token: tokenValue.trim() }),
});
if (!res.ok) throw new Error("Failed to save connection");
```

Remove any code that calls `localStorage.setItem("atlas-github-token", ...)` or
saves the token to a per-project endpoint. That path is retired.

---

## Step 3 — Load connection status on mount

At the top of ConnectionsTab, add a `useEffect` that fetches current connections:

```ts
const [githubConnected, setGithubConnected] = React.useState(false);
const [connectionId, setConnectionId] = React.useState<number | null>(null);

useEffect(() => {
  fetch("/api/connections")
    .then(r => r.ok ? r.json() : [])
    .then((data: { id: number; type: string }[]) => {
      const gh = data.find(c => c.type === "github");
      if (gh) {
        setGithubConnected(true);
        setConnectionId(gh.id);
      }
    })
    .catch(() => {});
}, []);
```

---

## Step 4 — Render connected vs disconnected state

Replace the existing token input UI with this conditional:

```tsx
{githubConnected ? (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", display: "inline-block", flexShrink: 0 }} />
      <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-fg)" }}>
        GitHub Connected
      </span>
    </div>
    <div style={{ fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.6 }}>
      Your token covers all projects. Atlas can read any linked repo.
    </div>
    <button
      type="button"
      onClick={async () => {
        if (!connectionId) return;
        await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
        setGithubConnected(false);
        setConnectionId(null);
      }}
      style={{ fontSize: 10, color: "var(--atlas-muted)", background: "transparent", border: "1px solid var(--atlas-border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", alignSelf: "flex-start", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}
    >
      Disconnect
    </button>
  </div>
) : (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.6 }}>
      Connect GitHub once — works for all your projects automatically.
    </div>
    <GithubTokenInput onSave={async (token) => {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "github", token }),
      });
      if (res.ok) { setGithubConnected(true); const d = await res.json(); setConnectionId(d.id ?? null); }
    }} />
  </div>
)}
```

---

## Step 5 — Add GithubTokenInput helper (before ConnectionsTab)

Add this component just before the `ConnectionsTab` function:

```tsx
function GithubTokenInput({ onSave }: { onSave: (token: string) => Promise<void> }) {
  const [value, setValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    try { await onSave(trimmed); setValue(""); } finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        placeholder="ghp_..."
        autoComplete="off"
        style={{ width: "100%", padding: "8px 10px", borderRadius: 6, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 11, fontFamily: "var(--app-font-mono)", outline: "none", boxSizing: "border-box" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
      />
      <button
        type="button"
        disabled={!value.trim() || saving}
        onClick={save}
        style={{ padding: "7px", borderRadius: 6, background: value.trim() ? "var(--atlas-gold)" : "var(--atlas-surface)", border: "none", color: value.trim() ? "#0D0B09" : "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", cursor: value.trim() ? "pointer" : "not-allowed" }}
      >
        {saving ? "Saving..." : "Connect"}
      </button>
    </div>
  );
}
```

> If `React` is not in scope, replace `React.useState` with `useState` — it's already imported.

---

## Step 6 — Run typecheck and push

```
pnpm --filter @workspace/atlas run typecheck
```

Fix any errors, then push to main.

---

## What this does

- Enter your GitHub token **once** in any workspace → saved to your account
- Every project with a linked repo immediately gets GitHub access — no per-project entry
- The Connections tab shows "GitHub Connected" with a green dot across all workspaces once set
- Disconnect button lets you revoke and re-enter if the token expires
- `localStorage` token storage is fully retired — backend connections table is the single source
