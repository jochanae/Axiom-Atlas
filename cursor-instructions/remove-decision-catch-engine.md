# Remove Decision Catch Engine from Frontend

Run `pnpm install` first if node_modules is missing.

## What this is

The Decision Catch Engine was a feature that intercepted certain AI responses, parsed a `DECISION_CATCH:{...}` JSON token, and rendered a special modal card asking the user to reconcile contradictions. It's being removed — the friction it creates outweighs the value, and the backend no longer emits the token.

## Step 1 — Search and remove the parser

File: `src/components/workspace/ChatStream.tsx` (or wherever SSE tokens are parsed — search for `DECISION_CATCH` across the repo)

Find any code that:
- Checks for `DECISION_CATCH` in the streamed text
- Parses JSON after that token
- Sets state like `catchCard`, `decisionCatch`, `activeCatch`, or similar
- Renders a catch card, modal, or overlay in response

Delete all of it. If there's a state variable for the catch card, delete the state declaration too.

Do not change anything else in the file.

## Step 2 — Remove the catch card component

Search the repo for files named anything like:
- `DecisionCatchCard.tsx`
- `CatchCard.tsx`  
- `ConflictCard.tsx`
- `AxiomDriftCard.tsx`

If any exist, delete the file entirely.

## Step 3 — Remove imports

In any file that imported the catch card component, remove that import line.

## Step 4 — Natural contradiction handling (no code change needed)

The backend now handles contradictions inline — Atlas will mention a tension naturally in its response text, in the same conversational flow, with no special UI. No replacement component is needed.

## Verification

After the change: send a message in the workspace that contains something that would previously have triggered a catch (e.g., referencing a different direction than a committed decision). The response should come through as normal text, no special card or modal appears.

Run typecheck, push to main.
