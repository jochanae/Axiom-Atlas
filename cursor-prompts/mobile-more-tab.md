# Mobile "More ···" Overflow Tab

## Problem
The mobile bottom nav has 5 tabs: Chat | Ledger | Files | Preview | Flow.
Memory, Blueprints, Connections, and Forge Thread are unreachable on mobile —
they only exist in the desktop right-pane tab bar which is hidden on mobile.

## Solution
Add a 6th "More ···" tab to `MobileTabBar`. Tapping it opens a bottom sheet
overlay listing the hidden tabs. Tapping any item in the sheet closes the sheet
and navigates to that tab in the right pane.

---

## File to edit
`artifacts/atlas/src/pages/workspace.tsx`

---

## Step 1 — Expand the tab type

Find this type (inside the `MobileTabBar` function props / the `activeTab` / `onTabChange` declarations):

```ts
activeTab: "chat" | "ledger" | "files" | "map" | "preview";
onTabChange: (tab: "chat" | "ledger" | "files" | "map" | "preview") => void;
```

Replace both with:

```ts
activeTab: "chat" | "ledger" | "files" | "map" | "preview" | "memory" | "blueprints" | "connections" | "forge";
onTabChange: (tab: "chat" | "ledger" | "files" | "map" | "preview" | "memory" | "blueprints" | "connections" | "forge") => void;
```

Do the same for the `RightTab` union wherever it is declared — it should already include
`"memory"`, `"blueprints"`, `"connections"`, and `"forge"`. If any of those are missing,
add them.

---

## Step 2 — Add `showMore` state inside `MobileTabBar`

Inside the `MobileTabBar` function body, right after the `const [, navTo] = useLocation();` line, add:

```ts
const [showMore, setShowMore] = React.useState(false);
```

---

## Step 3 — Add the "More" entry to the bottom tab list

The `tabs` array inside `MobileTabBar` currently ends with the "Flow/map" entry. 
**After** the closing `]` of that array (before `return (`), add nothing — we handle
"More" separately outside the `tabs.map(...)`.

Inside the returned JSX, **after** `{tabs.map(...)}` and before the closing `</div>` of the
outer container, add this "More" button and the bottom sheet:

```tsx
{/* ── More button ── */}
<button
  onClick={() => setShowMore(true)}
  style={{
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: ["memory","blueprints","connections","forge"].includes(activeTab)
      ? "var(--atlas-gold)"
      : "var(--atlas-muted)",
    transition: "color 180ms ease",
    position: "relative",
    WebkitTapHighlightColor: "transparent",
  }}
>
  {/* Active indicator bar */}
  <div style={{
    position: "absolute", top: 0, left: "20%", right: "20%", height: 2,
    borderRadius: "0 0 2px 2px",
    background: ["memory","blueprints","connections","forge"].includes(activeTab)
      ? "var(--atlas-gold)" : "transparent",
    transition: "background 180ms ease",
  }} />
  {/* ··· icon */}
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
  <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", lineHeight: 1 }}>
    More
  </span>
</button>

{/* ── More sheet overlay ── */}
{showMore && (
  <>
    {/* Backdrop */}
    <div
      onClick={() => setShowMore(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 290,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    />
    {/* Sheet */}
    <div
      style={{
        position: "fixed", bottom: 64, left: 0, right: 0,
        zIndex: 300,
        background: "var(--atlas-surface)",
        borderTop: "1px solid rgba(201,162,76,0.18)",
        borderRadius: "14px 14px 0 0",
        padding: "16px 0 12px",
      }}
    >
      <div style={{
        width: 36, height: 3, borderRadius: 2,
        background: "rgba(201,162,76,0.25)",
        margin: "0 auto 16px",
      }} />
      {(
        [
          {
            id: "memory" as const,
            label: "Memory",
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z"/>
                <path d="M8 9h8M8 13h8M8 17h5"/>
              </svg>
            ),
          },
          {
            id: "blueprints" as const,
            label: "Blueprints",
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18M9 21V9"/>
              </svg>
            ),
          },
          {
            id: "connections" as const,
            label: "Connections",
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="12" r="2"/>
                <circle cx="18" cy="6" r="2"/>
                <circle cx="18" cy="18" r="2"/>
                <path d="M8 11l8-4M8 13l8 4"/>
              </svg>
            ),
          },
          {
            id: "forge" as const,
            label: "Forge",
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            ),
          },
        ] as { id: "memory" | "blueprints" | "connections" | "forge"; label: string; icon: React.ReactNode }[]
      ).map(({ id, label, icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => { onTabChange(id); setShowMore(false); }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "13px 24px",
              background: active ? "rgba(201,162,76,0.07)" : "transparent",
              border: "none",
              borderLeft: `3px solid ${active ? "var(--atlas-gold)" : "transparent"}`,
              cursor: "pointer",
              color: active ? "var(--atlas-gold)" : "var(--atlas-fg)",
              fontFamily: "var(--app-font-mono)",
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              textAlign: "left",
              WebkitTapHighlightColor: "transparent",
              transition: "all 160ms ease",
            }}
          >
            {icon}
            {label}
            {active && (
              <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--atlas-gold)", opacity: 0.7 }}>
                ACTIVE
              </span>
            )}
          </button>
        );
      })}
    </div>
  </>
)}
```

---

## Step 4 — Wire the new tabs in the parent component

Find the place where `MobileTabBar` is rendered in the workspace page — it will look something like:

```tsx
<MobileTabBar
  activeTab={mobileTab}
  onTabChange={(t) => { ... }}
  entryCount={...}
  activeCatch={...}
/>
```

The `onTabChange` handler currently handles `"chat" | "ledger" | "files" | "map" | "preview"`.
Extend it to handle the new tabs by setting the right-pane tab. For example:

```tsx
onTabChange={(t) => {
  if (t === "map") { navTo("/map"); return; }
  if (t === "memory" || t === "blueprints" || t === "connections" || t === "forge") {
    // Switch to right-pane view and set the tab
    setMobileTab("ledger"); // or whatever state holds the active pane — use the right-pane state instead
    setRightPaneTab(t as RightTab);  // <- set the right-pane active tab
    // If the workspace uses a separate "show right pane on mobile" flag, set it here too
    return;
  }
  setMobileTab(t);
}}
```

You must trace back through the code to find the exact state variable names (`mobileTab`,
`setMobileTab`, `setRightPaneTab`, etc.) and use them correctly. The goal is:
- Tapping Memory / Blueprints / Connections / Forge in the More sheet shows the right pane
  with that tab active, exactly as if the user had tapped that tab on desktop.
- Do not change anything else in the layout.

---

## Step 5 — Typecheck

```
pnpm --filter @workspace/atlas run typecheck
```

Zero errors before pushing.
