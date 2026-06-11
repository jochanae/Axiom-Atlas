# Cursor Prompt — Competitor Research Card UI

Apply this to `jochanae/atlas-idk` (the live frontend repo) using Cursor Agent.

---

## Context

The backend now supports two ways Atlas performs competitor/product research:

1. **`/research <url>` slash command** — user types `/research https://notion.so` in the workspace chat input. Backend intercepts this before it reaches the AI and calls the scrape + analyze pipeline directly. Returns a `done` SSE event with a structured `researchResult` field.

2. **Proactive BROWSER_VISIT:scrape** — when a user asks "how does Notion work?" or "what does Linear charge?", Atlas emits a `BROWSER_VISIT` token and the backend runs the scrape. Result comes back in `browserResult` with `type: "scrape"`. The backend also now attaches a `researchResult` field to the same payload for the proactive scrape path.

Both paths produce the same `researchResult` shape in the SSE `done` event:

```typescript
researchResult: {
  type: "research";
  url: string;
  title: string;       // page title
  summary: string | null;  // AI strategic analysis (3-5 sentences)
  headings: string[];  // up to 6 key page headings
} | null
```

---

## What to Build

### 1. ResearchCard component

Create `src/components/ResearchCard.tsx`:

```tsx
import React from "react";

interface ResearchCardProps {
  url: string;
  title: string;
  summary: string | null;
  headings: string[];
}

export function ResearchCard({ url, title, summary, headings }: ResearchCardProps) {
  const domain = (() => {
    try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
  })();

  return (
    <div
      style={{
        background: "rgba(28, 25, 23, 0.85)",
        border: "1px solid rgba(201, 162, 76, 0.25)",
        borderRadius: "10px",
        padding: "14px 16px",
        marginTop: "10px",
        maxWidth: "520px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
          alt=""
          width={16}
          height={16}
          style={{ borderRadius: "3px", opacity: 0.85 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <span style={{ color: "#C9A24C", fontWeight: 600, fontSize: "13px" }}>
          Research
        </span>
        <span style={{ color: "#78716C", fontSize: "12px" }}>·</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#78716C", fontSize: "12px", textDecoration: "none" }}
        >
          {domain}
        </a>
      </div>

      {/* Title */}
      <p style={{ color: "#E7E5E4", fontSize: "14px", fontWeight: 600, margin: "0 0 8px" }}>
        {title}
      </p>

      {/* AI Summary */}
      {summary && (
        <p style={{ color: "#A8A29E", fontSize: "13px", lineHeight: 1.55, margin: "0 0 10px" }}>
          {summary}
        </p>
      )}

      {/* Key Sections */}
      {headings.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px" }}>
          <p style={{ color: "#78716C", fontSize: "11px", margin: "0 0 5px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Key sections
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {headings.map((h, i) => (
              <span
                key={i}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "4px",
                  padding: "2px 7px",
                  color: "#A8A29E",
                  fontSize: "11px",
                }}
              >
                {h}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

### 2. Wire ResearchCard into workspace chat

In `src/pages/workspace.tsx` (or wherever chat messages are rendered), after the assistant message bubble renders, check for `researchResult` on the message and render the card:

Find the section that maps over messages and renders the assistant bubble. Right after the markdown content renders, add:

```tsx
import { ResearchCard } from "../components/ResearchCard";

// Inside the message render, after the chat bubble text:
{msg.researchResult && (
  <ResearchCard
    url={msg.researchResult.url}
    title={msg.researchResult.title}
    summary={msg.researchResult.summary}
    headings={msg.researchResult.headings ?? []}
  />
)}
```

The `researchResult` field arrives on the SSE `done` event. Make sure when you store messages in state you spread the entire done payload onto the message object so `researchResult` is preserved alongside `content`, `messageId`, etc.

---

### 3. Quick-actions hint line

In `src/pages/workspace.tsx`, find the tip line that currently says:

```
TIP: Type /deep [topic] in any message to run a structured research analysis via Gemini
```

Update it to show both commands:

```tsx
TIP: Type{" "}
<span style={{ color: "rgba(201,162,76,0.7)" }}>/deep [topic]</span>{" "}
for structured research via Gemini, or{" "}
<span style={{ color: "rgba(201,162,76,0.7)" }}>/research [url]</span>{" "}
to analyze any product or competitor page.
```

---

### 4. TypeScript type update

Wherever the chat `done` payload type is defined (likely `WorkspaceMessage` or similar), add:

```typescript
researchResult?: {
  type: "research";
  url: string;
  title: string;
  summary: string | null;
  headings: string[];
} | null;
```

---

## Do not change anything else.

Run typecheck after applying. Push to main.
