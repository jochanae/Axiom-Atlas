# Fix — workspace broken when arriving from global insight navigation

## The problem
When home navigates to `/project/:id?global=true`, the workspace reads
`?global=true` and sets `effectiveId = 0`. This breaks the workspace because
`useChatStream(0)` tries to load project ID 0 which does not exist — the
workspace renders without its tools, tabs, and layout.

The backend already handles global questions via intent detection.
The `effectiveId = 0` approach is not needed and causes the breakage.

## File
`src/pages/workspace.tsx`

---

## Step 1 — Remove globalMode state and effectiveId (around line 3069)

Find:
```tsx
  const [globalMode, setGlobalMode] = useState(searchParams.get("global") === "true");
  const effectiveId = globalMode ? 0 : id;
  const [globalModeChipSlot, setGlobalModeChipSlot] = useState<HTMLElement | null>(null);
```

Replace with:
```tsx
```
(delete all three lines — nothing replaces them)

---

## Step 2 — Restore useChatStream to use id (not effectiveId)

Find:
```tsx
  } = useChatStream(effectiveId, {
```

Replace with:
```tsx
  } = useChatStream(id, {
```

---

## Step 3 — Remove the chip slot injection effect

Find this block (around line 4130):
```tsx
    const slot = document.createElement("span");
    slot.setAttribute("data-atlas-global-mode-slot", "true");
    slot.style.display = "inline-flex";
    slot.style.alignItems = "center";
    slot.style.flexShrink = "0";
    projectButton.insertAdjacentElement("afterend", slot);
    setGlobalModeChipSlot(slot);

    return () => {
      slot.remove();
```

Delete these lines from `slot.setAttribute` through the `slot.remove()` line.
Keep any surrounding `useEffect` cleanup logic that isn't related to the slot.

---

## Step 4 — Remove the chip portal (around line 5648)

Find:
```tsx
      {globalModeChipSlot && createPortal(
        <button
          type="button"
          onClick={() => setGlobalMode(prev => !prev)}
          style={{
            marginLeft: 8,
            padding: "2px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            border: globalMode
              ? "1px solid rgba(201,162,76,0.6)"
              : "1px solid rgba(255,255,255,0.12)",
            background: globalMode
              ? "rgba(201,162,76,0.12)"
              : "transparent",
            color: globalMode ? "var(--atlas-gold, #C9A24C)" : "var(--atlas-muted, #78716C)",
            cursor: "pointer",
            transition: "all 0.15s",
            WebkitTapHighlightColor: "transparent",
            flexShrink: 0,
          }}
        >
          {globalMode ? "All Projects" : "This project"}
        </button>,
        globalModeChipSlot
      )}
```

Delete the entire block above.

---

## What this fixes
- Workspace always loads with its full layout and tools regardless of how you arrive
- The ?global=true URL param is ignored at the workspace level (harmless)
- Atlas already detects portfolio-wide questions automatically on the backend
- No chip needed — Atlas adapts based on what you ask, not a toggle

## Do not change anything else.
## Run typecheck, push to main.
