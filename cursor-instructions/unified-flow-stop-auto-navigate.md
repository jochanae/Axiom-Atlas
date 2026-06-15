# Fix: Stop forced home→workspace navigation

## Problem
When Atlas creates a project from the home conversation, it immediately calls
`setLocation('/project/${projectId}')` — yanking the user away from the conversation
mid-thought. There are two places this happens (lines ~1990 and ~2734 in home.tsx).

The fix: instead of auto-navigating, show a persistent banner card that says
"Your workspace is ready — Open workspace →". The user taps it when they're ready.
No forced navigation.

---

## File
`src/pages/home.tsx`

---

## Step 1 — Add state (place near the other useState declarations, around line 1886)

Add this state:
```tsx
const [pendingWorkspace, setPendingWorkspace] = useState<{ id: number } | null>(null);
```

---

## Step 2 — Replace auto-navigate #1 (around line 1988-1990)

Find:
```tsx
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setActiveProjectId(projectId);
      setLocation(`/project/${projectId}`);
```

Replace with:
```tsx
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setActiveProjectId(projectId);
      setPendingWorkspace({ id: projectId });
```

---

## Step 3 — Replace auto-navigate #2 (around line 2731-2734)

Find:
```tsx
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setActiveProjectId(projectId);
      setLocation(`/project/${projectId}`);
    } catch (err) {
      handleSubmitError(err);
    } finally {
      resetSubmitState();
```

Replace with:
```tsx
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setActiveProjectId(projectId);
      setPendingWorkspace({ id: projectId });
    } catch (err) {
      handleSubmitError(err);
    } finally {
      resetSubmitState();
```

---

## Step 4 — Add the workspace-ready banner

Find where the chat messages render in the JSX (look for the area that renders
`nexusChat.messages` in a scrollable container). Add this banner ABOVE the
message list, so it appears pinned at the top of the conversation:

```tsx
{pendingWorkspace && (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 16px",
      margin: "8px 12px 0",
      borderRadius: 10,
      background: "rgba(201,162,76,0.08)",
      border: "1px solid rgba(201,162,76,0.25)",
      gap: 12,
    }}
  >
    <span style={{ fontSize: 14, color: "var(--atlas-fg)", flex: 1 }}>
      Your workspace is ready. Continue here or go deeper.
    </span>
    <button
      type="button"
      onClick={() => {
        setPendingWorkspace(null);
        setLocation(`/project/${pendingWorkspace.id}`);
      }}
      style={{
        flexShrink: 0,
        padding: "7px 14px",
        borderRadius: 8,
        background: "var(--atlas-ember)",
        color: "#fff",
        border: "none",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      Open workspace →
    </button>
    <button
      type="button"
      aria-label="Dismiss"
      onClick={() => setPendingWorkspace(null)}
      style={{
        flexShrink: 0,
        background: "transparent",
        border: "none",
        color: "var(--atlas-muted)",
        fontSize: 18,
        cursor: "pointer",
        lineHeight: 1,
        padding: "0 4px",
      }}
    >
      ×
    </button>
  </div>
)}
```

---

## What this achieves
- No more forced page navigation when Atlas creates a project from the home chat
- Conversation stays exactly where it is
- A quiet gold banner appears at the top: "Your workspace is ready"
- User taps "Open workspace →" when they're ready — then and only then it navigates
- They can dismiss it with × and stay in the home conversation indefinitely
- The Think Freely path, new-project-modal path (intentional), and manual project taps
  are NOT changed — only the two auto-navigate triggers

## Do not change anything else.
## Run typecheck, push to main.
