---
name: Quick Action Enhancement — Phase 3
description: Planned redesign of the Quick Action section on the Atlas home screen, inspired by Cursor's composer agent pattern. Parked until Phase 1 and 2 core loop are working.
---

## The idea

The current Quick Action (on the home screen Activity section) opens a form requiring the user to select project, branch, and file path before describing a change. This is the wrong shape for Atlas's user — it requires technical context before the user has even typed anything.

## The direction

Replace the form with a single text input, front and center on the home screen — similar to Cursor's composer agent entry point.

- User types what they want ("fix that thing on my app", "add the feature we talked about")
- Atlas orients itself — identifies which project, figures out the file, acts
- No branch selector, no file path field required
- Continues the session thread without navigating into full workspace

## Why it matters

Passes the Founder Filter: this is Phase 1 Action 3 — "Let the user continue building from where they left off." A non-technical founder should be able to act from the home screen without navigating into a workspace.

The Cursor reference: `cursor.com/agents` — one input box, model selector, list of recent agent threads below. The follow-up input at the bottom of each agent thread continues the same session.

## What it is NOT

Not a form. Not a project/branch/file selector. Not a technical interface. Just: describe what you want, Atlas handles the routing.

## Phase assignment

Phase 3. Do not build until Phase 1 core loop (Chat → Project → Build → Run → Continue) is working end-to-end.

## Current state

Quick Action exists on the home screen but does not work. The form shape is wrong for the audience even when it does work. Full redesign needed, not a patch.
