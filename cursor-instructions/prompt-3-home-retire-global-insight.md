# Prompt 3 of 3 — home: retire Global Insight surface, route to workspace

## File
`src/pages/home.tsx`

## What this does
Global Insight is being retired as a separate surface.
When the user triggers it, they now go directly to the workspace in "All Projects" mode.
The workspace handles the global/portfolio conversation from there.

---

## Step 1 — Find the most recent active project helper (around line 2185)

There is already a `mostRecentActiveProjectId` variable. We will use it.

---

## Step 2 — Replace the three `callGlobalInsightMode(true)` calls

Search for all three occurrences of:
```tsx
void callGlobalInsightMode(true);
```

Replace EACH one with:
```tsx
if (mostRecentActiveProjectId) {
  setLocation(`/project/${mostRecentActiveProjectId}?global=true`);
} else {
  setLocation("/projects");
}
```

There are exactly 3 occurrences. Replace all 3.

---

## Step 3 — Add `setLocation` to the dependency arrays that contained `callGlobalInsightMode`

If any `useCallback` dependency array contained `callGlobalInsightMode` after
one of the replacements above, add `setLocation` to that dependency array
(it is already imported and available from `useLocation`).

---

## What this achieves
- Tapping "Global Insight" anywhere on home now navigates directly to the workspace
- The workspace opens in "All Projects" mode (global=true URL param)
- Atlas answers from the full portfolio in the workspace
- No separate surface, no overlay — one place for everything

## Do not remove GlobalInsightSurface or callGlobalInsightMode from the file —
## just replace the three trigger calls. Leave everything else intact.
## Run typecheck, push to main.
