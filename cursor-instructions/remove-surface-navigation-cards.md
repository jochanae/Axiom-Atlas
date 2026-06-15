# Remove Surface Navigation Cards (Tension Map + Decision Catch)

## What changed on the backend
- The backend no longer emits `surface: "MAP"` in chat `done` events. That type is gone.
- The backend still emits `surface: "DECISION"` and `surface: "WORKSPACE"` in some cases, but these should NOT trigger page navigation or interrupt the conversation.

## What to remove / change on the frontend

### 1. Remove Tension Map card rendering
In the workspace chat component (wherever `done` events from `/api/chat` are parsed), find the code that checks `surface === "MAP"` or renders a "Tension Map" card with a "VIEW STRUCTURE" button. Delete the entire block — it will never fire from the backend again, and it navigated users away from the conversation unexpectedly (to the Axiom Flow / Master Map page).

The card looked like:
```
Tension Map
interconnected tensions
[VIEW STRUCTURE]  [NOT NOW]
```

Remove it entirely.

### 2. Remove DECISION surface card (the blocking interrupt card)
Find where `surface === "DECISION"` renders a card that appears in the chat and interrupts the conversation flow — the one with "Log this decision" and buttons like "Proceed anyway / Confirm / Adjust". This is the Decision Catch Engine UI.

Remove the blocking card UI entirely. Do NOT navigate anywhere. Do NOT show a modal.

If you want to keep a very subtle signal, a tiny non-blocking chip below the message like "💾 Save to Ledger" (tappable) is acceptable — but only if it does NOT interrupt the conversation or require action.

### 3. Verify WORKSPACE surface does not navigate
If `surface === "WORKSPACE"` currently triggers any navigation or page change, remove that behavior too. Surface signals from the backend should at most show a subtle informational chip — they must never navigate the user away from the chat.

### 4. No other changes needed
Do not change anything else. Do not modify the chat request, the SSE parsing, or the portfolio context handling — those are backend concerns already handled.

## Files to look in
- The workspace chat panel component (likely `workspace.tsx` or a child component like `ChatPanel.tsx` or `WorkspaceChat.tsx`)
- Search for `surface` or `surfaceSignal` or `Tension Map` or `VIEW STRUCTURE` or `DECISION_CATCH` or `catchPayload`

## Do not change
- `/api/chat` request shape
- SSE parsing logic
- Ledger, GitHub, FILE_EDIT, terminal — untouched
- Any other page or component
