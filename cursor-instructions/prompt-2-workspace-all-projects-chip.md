# Prompt 2 of 3 — workspace: "All Projects" global mode chip

## File
`src/pages/workspace.tsx`

## Step 1 — Add globalMode state (after line ~3068 where showIntake is declared)

Find:
```tsx
  const [showIntake, setShowIntake] = useState(searchParams.get("intake") === "true");
```

Replace with:
```tsx
  const [showIntake, setShowIntake] = useState(searchParams.get("intake") === "true");
  const [globalMode, setGlobalMode] = useState(searchParams.get("global") === "true");
```

---

## Step 2 — Use effectiveId for useChatStream (around line 3066)

Find:
```tsx
  const id = Number(projectId) || Number(window.location.pathname.split('/project/')[1]?.split('/')[0]);
```

Replace with:
```tsx
  const id = Number(projectId) || Number(window.location.pathname.split('/project/')[1]?.split('/')[0]);
  const effectiveId = globalMode ? 0 : id;
```

---

## Step 3 — Pass effectiveId to useChatStream (around line 3310)

Find:
```tsx
  } = useChatStream(id, {
```

Replace with:
```tsx
  } = useChatStream(effectiveId, {
```

---

## Step 4 — Add "All Projects" chip near project name

Find where the project name is displayed in the JSX header at the top of the
workspace (look for where `project?.name` or `projectName` is rendered in the
top bar/header area). Add this chip immediately after the project name:

```tsx
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
</button>
```

When `globalMode` is true:
- The chip shows gold / "All Projects"
- Messages go to the backend without a projectId → Atlas answers from the full portfolio
- When `globalMode` is false: normal project-scoped chat

---

## Do not change anything else.
## Run typecheck, push to main.
