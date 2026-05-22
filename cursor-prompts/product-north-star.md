# Axiom — Product North Star
*Locked May 22, 2026*

---

## What This Product Is

Axiom is a strategic thinking partner. Not a project manager. Not a note-taker.
A thinking partner — the kind that remembers what you said last week, notices when
you're contradicting yourself, and helps you think through what you're actually building
before you build the wrong thing.

It works for:
- A founder describing a kitchen appliance idea with no attachments
- A developer who zips their codebase and wants architectural feedback
- A solo builder who links their GitHub and wants Atlas to know the code
- Anyone who just needs to think out loud with something that actually listens

**No attachment is required. Context enriches — it doesn't gate.**

---

## The Three Context Levels

| Level | What the user provides | What Atlas does |
|-------|------------------------|-----------------|
| 0 | Nothing — just conversation | Thinks with them. Asks the right questions. |
| 1 | A live URL | Visits it. Sees the actual product. References it visually. |
| 2 | A ZIP file | Indexes the full codebase. Identical experience to GitHub. |
| 3 | A GitHub repo | Live, auto-updating, write-back capable. |

All three should feel like the full product. Level 0 is not a degraded experience —
it is the entry experience. Everything else adds depth.

---

## Forge as the Entry Point

When a project is created, Forge activates immediately — not as a tab, as the first moment.

Atlas leads with 6 intake questions:
1. What are you building — describe it plainly
2. Who is it for — who's the user, what problem does it solve
3. What stage — idea, early build, live, scaling
4. What's working — what are you already confident about
5. What's the open question — the thing you haven't resolved yet
6. How do you like to think — do you want pushback, or space to explore

If context is attached (ZIP/URL/GitHub), Forge uses it to make the questions sharper.
If nothing is attached, the questions still work — and work well.

The Forge intake is the onboarding. Every project starts here.

---

## The Five-Tier Memory System (Seeded from Forge)

The Forge intake seeds the memory system. Every subsequent conversation builds on it.

| Tier | Source | What it holds |
|------|--------|---------------|
| 1 — Foundation | Forge intake | What they're building, who for, what stage, core tension |
| 2 — Codebase | Repo/ZIP scan | Stack, routes, components, tables, architecture |
| 3 — Decisions | Decision Ledger | Committed choices, deviations, the why behind each |
| 4 — Patterns | Conversation history | How they think, what they care about, work style |
| 5 — Evolution | Over time | How the project and the person have changed |

When a user reopens a workspace: Atlas knows Tiers 1–5.
It doesn't ask "what are you building." It asks "last session you were figuring out X — where did you land?"

---

## Page Audit — What Stays, What Goes

### KEEP — Core experience
| Page | Why |
|------|-----|
| `/home` | Global intelligence layer. Briefing + wide-lens chat. The face. |
| `/project/:id` (workspace) | The engine. Chat + Ledger + context. |
| `/projects` | Navigation hub. Active + archived. |
| `/ledger` | Standalone ledger view. Useful for review sessions. |
| `/login` | Auth. Obviously. |
| `/help` | Small, low-maintenance, needed. |

### SIMPLIFY — Good concept, wrong surface
| Page | Decision |
|------|----------|
| `/parking-lot` | Collapse into a tab inside workspace. Not a standalone page. |
| `/master-map` | Keep — but only surface it after Forge intake completes. It's a reward, not a starting point. |

### AUDIT — Unclear purpose, possible redundancy
| Page | Question |
|------|----------|
| `/dashboard` | What does this do that `/home` doesn't? If it's a duplicate, remove it. If it's different, define it clearly. |
| `/think-freely` | Is this different enough from home chat to justify its own page? Or is it a mode on the home chat? |
| `/workshop` | What specifically does this surface? Needs a clear definition or removal. |
| `/project-compass` | Same question. Define or remove. |

### REMOVE
| Page | Why |
|------|-----|
| `nexus.tsx` | Legacy redirect. Already deprecated. Clean it up. |
| `/vault` | Built but not surfaced. Move to Connections tab until it has a proper UX moment. |

---

## Build Sequence

These are in order. Do not skip ahead.

### Phase 1 — Mobile first (current work)
- More ··· tab in mobile bottom nav ← in progress
- GitHub token: account-level OAuth (remove per-project localStorage pattern)
- ZIP upload as first-class context method (equal to GitHub)

### Phase 2 — Forge as entry point
- New project flow → Forge intake activates immediately
- 6-question intake → answers write to Project Memory (Tier 1)
- Context (ZIP/URL/GitHub) can be added during or after intake
- Forge accessible anytime from workspace to run a new extraction

### Phase 3 — Memory system built on Forge
- Tier 1 written by Forge intake
- Tier 2 written by repo/ZIP scan
- Tier 3 written by Decision Catch Engine (already exists)
- Tier 4 inferred from conversation patterns (new — AI-written on session close)
- Tier 5 milestone tracking (new — surfaced in Memory tab)
- Every workspace open: Atlas opens with a one-line recall of the current state

### Phase 4 — Page cleanup
- Audit and decide dashboard / think-freely / workshop / project-compass
- Remove or clearly define each
- Simplify nav to only what earns its place

### Phase 5 — URL intelligence
- When a URL is pasted: Atlas visits it, takes a screenshot, scrapes meta
- Detects Vercel/Netlify/Railway/Render automatically
- Visual context injected into chat alongside text context

---

## What Makes This Different

Most AI tools ask you to describe your project every time.
Axiom learns it once and remembers everything.

Most AI tools require a codebase attachment to be useful.
Axiom works from conversation alone — and gets smarter as you add context.

Most AI tools are reactive.
Axiom is proactive — it notices tensions, flags contradictions, and asks the question
you haven't thought to ask yet.

That is the product. Everything we build should serve that promise.
