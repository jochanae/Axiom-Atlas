# Atlas DB Awareness — Phase 2: Migration Approval Card (workspace.tsx)

## What this builds
When Atlas proposes a database schema change, it wraps the SQL in
`DB_MIGRATION_START ... DB_MIGRATION_END` markers. Right now those markers
appear as raw text in the chat. This prompt makes them render as a styled
approval card instead — showing the SQL clearly with a one-tap Copy button.

No backend changes are needed. The system prompt was already updated in Phase 1.

---

## File to change
`src/pages/workspace.tsx`

---

## Step 1 — Parse migration blocks from the chat message

Find the `cmdExec` / `cleanContent` useMemo (around where CMD_EXEC is parsed):

```ts
  const { cmdExec, cleanContent } = useMemo(() => {
    const m = message.content.match(/CMD_EXEC:(\{[^}]*\})/);
    if (m) {
      try {
        const parsed = JSON.parse(m[1]) as { command: string; description?: string };
        if (typeof parsed.command === "string") {
          return {
            cmdExec: parsed,
            cleanContent: message.content.replace(/\n?CMD_EXEC:\{[^}]*\}/g, "").trim(),
          };
        }
      } catch {}
    }
    return { cmdExec: null, cleanContent: message.content };
  }, [message.content]);
```

Add this new useMemo immediately **after** it:

```ts
  // Parse DB_MIGRATION_START...DB_MIGRATION_END blocks from Atlas response
  const { migrationBlocks, displayContent } = useMemo(() => {
    const blocks: string[] = [];
    const pattern = /DB_MIGRATION_START\s*([\s\S]*?)\s*DB_MIGRATION_END/g;
    let match: RegExpExecArray | null;
    let stripped = cleanContent;
    while ((match = pattern.exec(cleanContent)) !== null) {
      const sql = match[1]?.trim();
      if (sql) blocks.push(sql);
    }
    if (blocks.length > 0) {
      stripped = cleanContent.replace(/\n?DB_MIGRATION_START[\s\S]*?DB_MIGRATION_END\n?/g, "").trim();
    }
    return { migrationBlocks: blocks, displayContent: stripped };
  }, [cleanContent]);
```

---

## Step 2 — Pass `displayContent` into ChunkedBubbles instead of `cleanContent`

Find this line:

```tsx
        <ChunkedBubbles
          text={cleanContent}
```

Replace `text={cleanContent}` with `text={displayContent}`:

```tsx
        <ChunkedBubbles
          text={displayContent}
```

---

## Step 3 — Render MigrationCard blocks after ChunkedBubbles

Find the closing of the ChunkedBubbles section and the start of the plan card:

```tsx
        {message.plan && planState !== "skipped" && (
          <PlanCard
```

Add the migration cards between `ChunkedBubbles` and `PlanCard`:

```tsx
        {migrationBlocks.map((sql, i) => (
          <MigrationCard key={i} sql={sql} />
        ))}

        {message.plan && planState !== "skipped" && (
          <PlanCard
```

---

## Step 4 — Add the MigrationCard component

Find the line where the `DecisionCatchCard` or `ChatMessage` component function is defined
(or any top-level function component in the file — you want to add this **before**
the `ChatMessage` or `AssistantBubble` function, whichever renders the bubble).

Add this entire component just before that function:

```tsx
function MigrationCard({ sql }: { sql: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(sql).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        marginTop: 10,
        borderRadius: 8,
        border: "1px solid rgba(201,162,76,0.28)",
        background: "rgba(201,162,76,0.04)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 12px",
          borderBottom: "1px solid rgba(201,162,76,0.15)",
          background: "rgba(201,162,76,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {/* DB icon */}
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <ellipse cx="8" cy="4" rx="6" ry="2.2" stroke="rgba(201,162,76,0.8)" strokeWidth="1.3" />
            <path d="M2 4v4c0 1.21 2.69 2.2 6 2.2s6-.99 6-2.2V4" stroke="rgba(201,162,76,0.8)" strokeWidth="1.3" />
            <path d="M2 8v4c0 1.21 2.69 2.2 6 2.2s6-.99 6-2.2V8" stroke="rgba(201,162,76,0.8)" strokeWidth="1.3" />
          </svg>
          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 9,
              letterSpacing: "0.13em",
              textTransform: "uppercase" as const,
              color: "rgba(201,162,76,0.85)",
            }}
          >
            Schema Change
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            padding: "4px 10px",
            borderRadius: 5,
            border: "1px solid rgba(201,162,76,0.35)",
            background: copied ? "rgba(201,162,76,0.18)" : "transparent",
            color: copied ? "rgba(201,162,76,1)" : "rgba(201,162,76,0.7)",
            fontSize: 10,
            fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.08em",
            cursor: "pointer",
            transition: "all 140ms ease",
          }}
        >
          {copied ? "Copied ✓" : "Copy SQL"}
        </button>
      </div>

      {/* SQL body */}
      <pre
        style={{
          margin: 0,
          padding: "10px 12px",
          fontFamily: "var(--app-font-mono)",
          fontSize: 11.5,
          lineHeight: 1.7,
          color: "rgba(231,229,228,0.85)",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {sql}
      </pre>
    </div>
  );
}
```

> **Note:** If `React` is not in scope at that location (e.g. the file uses named
> imports like `import { useState } from "react"`), replace `React.useState` with
> `useState` — it should already be imported at the top of the file.

---

## Step 5 — Run typecheck and push

```
pnpm --filter @workspace/atlas run typecheck
```

Fix any errors, then push to main.

---

## What this does end-to-end

1. Atlas responds with schema change SQL wrapped in markers:
   ```
   DB_MIGRATION_START
   ALTER TABLE recipes ADD COLUMN category text NOT NULL DEFAULT 'general';
   DB_MIGRATION_END
   ```

2. The frontend parses the block out of the message text

3. Instead of showing the raw markers, the chat bubble renders a gold-bordered card:
   ```
   ┌─────────────────────────────────────────────────────┐
   │ 🗄  SCHEMA CHANGE                       [Copy SQL]  │
   ├─────────────────────────────────────────────────────┤
   │ ALTER TABLE recipes                                  │
   │   ADD COLUMN category text NOT NULL DEFAULT 'general'│
   └─────────────────────────────────────────────────────┘
   ```

4. Tap **Copy SQL** → SQL is on the clipboard, ready to paste into Neon, Supabase,
   Railway, or any Postgres console

5. Multiple migration blocks in a single response each get their own card

The card uses the same gold (`--atlas-gold`) color system as the rest of the workspace.
