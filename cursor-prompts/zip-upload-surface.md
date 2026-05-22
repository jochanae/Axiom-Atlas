# Surface ZIP Upload in Files Tab

## What Already Exists
`ZipImport.tsx` is fully built and wired into the workspace. It works today via:
- Drag a ZIP file onto the chat panel → ZipDragOverlay appears → files are parsed
- Click the paperclip/attachment button → file picker accepts `.zip`

The `processZip` function, `zipFiles` state, `zipName`, and `zipTruncated` all live
in the parent workspace component. The hidden file input has `id="ws-file-input"`.

## Problem
- On mobile, drag-and-drop does not work
- There is no visible "Upload ZIP" affordance anywhere in the UI
- Users who don't have GitHub have no obvious path to add code context

## Fix
Add a visible "Upload ZIP" section to the FilesTab, above the GitHub token input.
It shows a button that triggers the existing file input. When a ZIP is loaded,
it shows a confirmation row so the user knows it's active.

---

## File to edit
`artifacts/atlas/src/pages/workspace.tsx`

---

## Step 1 — Add props to FilesTab

Find the `FilesTab` function signature:

```ts
function FilesTab({
  projectId,
  onFileContext,
  onLinkedRepoChange,
}: {
  projectId: number;
  onFileContext: (ctx: string | null) => void;
  onLinkedRepoChange: (repo: LinkedRepo | null) => void;
})
```

Add two optional props:

```ts
function FilesTab({
  projectId,
  onFileContext,
  onLinkedRepoChange,
  onZipTrigger,
  zipLoaded,
  zipFileName,
}: {
  projectId: number;
  onFileContext: (ctx: string | null) => void;
  onLinkedRepoChange: (repo: LinkedRepo | null) => void;
  onZipTrigger?: () => void;
  zipLoaded?: boolean;
  zipFileName?: string;
})
```

---

## Step 2 — Add the ZIP section inside FilesTab JSX

Find the place in FilesTab's returned JSX where the GitHub token input section
begins — it will have a label like "GITHUB TOKEN" or similar. 

**Before** that token section, insert this ZIP upload section:

```tsx
{/* ── ZIP Upload ── */}
<div style={{ marginBottom: 20 }}>
  <div style={{
    fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em",
    textTransform: "uppercase", color: "var(--atlas-muted)", marginBottom: 8,
    display: "flex", alignItems: "center", justifyContent: "space-between",
  }}>
    <span>Upload ZIP</span>
    {zipLoaded && (
      <span style={{
        fontSize: 9, color: "rgba(134,239,172,0.8)",
        background: "rgba(134,239,172,0.08)",
        border: "1px solid rgba(134,239,172,0.2)",
        padding: "2px 7px", borderRadius: 10,
      }}>
        ACTIVE
      </span>
    )}
  </div>

  {zipLoaded ? (
    /* ZIP is loaded — show confirmation row */
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px", borderRadius: 7,
      background: "rgba(201,162,76,0.05)",
      border: "1px solid rgba(201,162,76,0.2)",
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(201,162,76,0.8)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      </svg>
      <span style={{
        flex: 1, fontSize: 11, fontFamily: "var(--app-font-mono)",
        color: "rgba(201,162,76,0.85)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {zipFileName || "ZIP loaded"}
      </span>
      <button
        onClick={() => onZipTrigger?.()}
        style={{
          background: "transparent",
          border: "1px solid rgba(201,162,76,0.2)",
          borderRadius: 5, padding: "3px 9px",
          fontSize: 9.5, fontFamily: "var(--app-font-mono)",
          color: "rgba(201,162,76,0.6)",
          cursor: "pointer", letterSpacing: "0.06em",
        }}
      >
        Replace
      </button>
    </div>
  ) : (
    /* No ZIP — show upload button */
    <button
      onClick={() => onZipTrigger?.()}
      style={{
        width: "100%", padding: "11px 14px",
        background: "rgba(201,162,76,0.04)",
        border: "1px dashed rgba(201,162,76,0.25)",
        borderRadius: 7, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
        color: "rgba(201,162,76,0.7)",
        fontFamily: "var(--app-font-mono)",
        fontSize: 11, letterSpacing: "0.06em",
        textTransform: "uppercase",
        transition: "all 160ms ease",
        WebkitTapHighlightColor: "transparent",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = "rgba(201,162,76,0.08)";
        e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "rgba(201,162,76,0.04)";
        e.currentTarget.style.borderColor = "rgba(201,162,76,0.25)";
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      Upload ZIP — no GitHub needed
    </button>
  )}

  <div style={{
    marginTop: 6, fontSize: 10, color: "rgba(120,113,108,0.5)",
    fontFamily: "var(--app-font-sans)", lineHeight: 1.5,
  }}>
    Drop a ZIP of your project and Atlas reads the code directly. No repo required.
  </div>
</div>
```

---

## Step 3 — Pass props from the parent to FilesTab

Find where FilesTab is rendered in the workspace — it will look like:

```tsx
{tab === "files" && <FilesTab projectId={projectId} onFileContext={onFileContext} onLinkedRepoChange={onLinkedRepoChange} />}
```

Update it to pass the new props:

```tsx
{tab === "files" && (
  <FilesTab
    projectId={projectId}
    onFileContext={onFileContext}
    onLinkedRepoChange={onLinkedRepoChange}
    onZipTrigger={() => {
      // Trigger the existing hidden file input that already accepts .zip
      const input = document.getElementById("ws-file-input") as HTMLInputElement | null;
      input?.click();
    }}
    zipLoaded={zipFiles.length > 0}
    zipFileName={zipName}
  />
)}
```

Where `zipFiles` and `zipName` are the existing state variables in the parent
workspace component (already defined — search for `zipFiles` to confirm the names).

---

## Step 4 — Typecheck

```
pnpm --filter @workspace/atlas run typecheck
```

Zero errors before pushing.
