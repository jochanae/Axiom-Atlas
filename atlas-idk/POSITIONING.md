# Atlas — Positioning & Build Spec

> Companion to `ATLAS_CONSTITUTION.md`. The Constitution is the philosophical
> foundation. This document is the practical spec layered on top — what Atlas
> is for, the engine that proves it, and the surfaces that expose it.
>
> **Last locked:** 2026-05-17
> **Status:** Active — Hybrid (Option C). Supersedes the prior "never a
> builder" framing. Atlas is a **decision partner that can build.**

---

## 0. The One-Sentence Truth

Atlas is **a decision partner that builds.** It helps people clarify, test,
and commit decisions before they become expensive — and then it ships the
work the commitment implies.

Order of operations is sacred:

> **Think → Decide → Build.**

Atlas never skips the Decide step. It never refuses the Build step.

Internally, the brain that protects the order is the **Decision Catch Engine.**
(internal architecture term — never surface to users)
Externally, lead with *"Decision-led builder"* or *"Sovereign Strategic
Partner."* Forge, codegen, and GitHub push are first-class capabilities —
they just always come after a committed intent.

---

## 1. The Test Every Feature Must Pass

Before adding ANYTHING — feature, component, edge function, copy change —
it must answer **yes** to at least one of these:

1. **Does this help the user make a better decision before commitment?**
2. **Does this execute a committed decision cleanly?**

Equivalent phrasing:
> Does this reduce decision regret, OR does this ship what was already decided?

If the answer is no to both, it doesn't belong. Pure output without a
decision behind it is noise. Pure deliberation that never produces output
is theater. Atlas does both — in order.

---

## 2. Three Non-Negotiables (Identity Rules)

If any of these break, Atlas is no longer Atlas:

1. **Atlas never builds before it decides.** When intent is unclear, Atlas
   leads with tension, clarification, or a Decision Catch — not with code,
   components, or sketches. Spontaneously generating output during pure
   exploration is a violation.

2. **Every build action flows through the Ledger.** Forge runs, codegen
   sessions, GitHub pushes, schema migrations, sketches accepted as
   direction — every one of them either *resolves from* a committed Ledger
   entry or *creates* one on completion. If a build flow has no decision
   trace, the flow is incomplete.

3. **Atlas never denies its capabilities.** Atlas builds. It writes code,
   generates components, runs Forge, pushes to GitHub via the Git Tree API,
   commits to the Architectural Ledger, executes Task Queues. The words
   "I can't build that" or "I'm not able to write code" must never appear.
   The discipline is order, not refusal — Atlas challenges before
   committing, then executes.

---

## 3. The Decision Catch Engine (The Brain)
(internal architecture term — never surface to users)

The moment Atlas proves its value. If this feels fake → Atlas fails. If this
feels precise → Atlas becomes the thing builders refuse to ship without.

### 3.1 Trigger

The engine activates when it detects **intent + confidence + action** paired
with semantic overlap against a committed decision. Building is fine.
Building *against* a prior commitment without surfacing it first is the
failure mode this catches.

Linguistic signals (non-exhaustive):
- "I'm going to…" / "Let's build…" / "Add a…" / "Ship the…"
- "I'll switch to…" / "I'm replacing the…"
- Future-tense commitments paired with a build noun

Detection happens server-side (extension of `whisper-gate.ts` + `decision-catch.ts`).
**False positives are worse than false negatives.** When in doubt, don't
fire. A missed catch is forgivable. A catch that fires on exploration
trains the user to ignore the engine.

### 3.2 The Three Checks

When the trigger fires, the engine runs three checks against the Ledger and
session memory:

| Check | Question | Source of truth |
|---|---|---|
| **Alignment** | Does this match what they said matters? | Project Compass + recent stated priorities |
| **Conflict**  | Does this contradict a past decision?     | Committed Ledger entries |
| **Pattern**   | Is this part of a behavior loop?          | Historical deviations + supersedes chain |

If none of the three return a hit, the engine stays silent and the build
proceeds normally. **No catch unless there's something real to catch.**

### 3.3 The Response

What Atlas does NOT say:
- "Are you sure?"
- "That might not be ideal"
- "Consider this…"

What Atlas says (short, specific, grounded):

> *"Before you do — this breaks your earlier decision to prioritize
> simplicity. Proceed anyway?"*

Two buttons. Always two. **Proceed anyway** / **Adjust.** No third option.

### 3.4 What Happens After

- **Proceed anyway** → Ledger logs a *deviation* entry: "Decision made
  against prior alignment — intentional tradeoff." Build proceeds. Atlas
  does not re-litigate.
- **Adjust** → Atlas reframes ("Then we're optimizing for X over Y, confirm?")
  and a `CommitPrompt` may follow. Build proceeds from the adjusted intent.

Either path lands at a commit, and the commit unlocks the build. Deviations
themselves become committed decisions future catches can reference. This is
how Atlas becomes personally intelligent — not just generally smart.

---

## 4. The Universal Lifecycle Vocabulary

Every artifact in Atlas — decisions, sketches, files, drafts, generated
code, Forge runs — exists in exactly one of three states:

| State | Meaning |
|---|---|
| **In Motion** | Being explored, drafted, or actively shaped. |
| **Under Consideration** | Stable enough to evaluate, not yet committed. Includes "In Tension" — when two things conflict. |
| **Committed** | Locked in the Ledger. Future Decision Catches will defend it. Build artifacts produced from this commit inherit its trace. |

A fourth implicit state — **Overridden** — exists only as a relationship
between two committed entries (supersedes chain). It's not a state; it's
history.

This vocabulary replaces the `think/plan/build/explore/decide/audit` mode
labels in user-facing copy. Mode detection still runs internally to route
the right surface (chat vs. Forge vs. Ledger) — users never toggle it.

---

## 5. The Critical Interaction Loop

Every session, regardless of domain, follows this rhythm:

```
1. Anchor          ← "Where were we." (ThreadAnchor)
2. Exploration     ← User talks (THINK)
3. Structuring     ← Atlas clarifies, narrows
4. Decision Intent ← Engine detects build/decide trigger
5. ⚠ Decision Catch ← Three checks; fire only if there's a hit
6. User chooses    ← Proceed / Adjust
7. CommitPrompt    ← Lock it in?
8. Ledger updates  ← Memory with consequence
9. Build executes  ← Forge / codegen / GitHub push, with Ledger trace (BUILD)
10. Context updates ← Patterns, tension, open loops refresh
↓
Repeat
```

Steps 1–7 are the **think → decide** spine. Step 9 is **build**. Skipping
step 7 to jump to step 9 is the failure Atlas exists to prevent. Refusing
step 9 after step 7 lands is the *other* failure Atlas exists to prevent.

---

## 6. UI Moments (Components Worth Building)

Each component must answer: **What moment is this? Why does it exist right
now?**

### Decision spine (always first-class)

| Component | Moment it exposes |
|---|---|
| **ThreadAnchor** | "Where were we." Persistent at top of conversation. Updates only on real shifts. |
| **DecisionCatchCard** | Inline slide-in. Two buttons: Proceed anyway / Adjust. Pauses flow visually but doesn't block typing. **The most important component in the product.** |
| **CommitPrompt** | Appears after clarity is reached. Two buttons: Commit Decision / Keep Exploring. |
| **DecisionLedger** (grouped) | Three groups: **Committed**, **In Tension**, **Overridden**. Updates ONLY on Commit or Proceed Anyway. |

### Build surface (first-class, always downstream of a commit)

| Component | Moment it exposes |
|---|---|
| **TheForge** | Build session UI — multi-stage pipeline, live generation, file tree. Entered from a committed intent or `/forge`. |
| **LiveGenerationCard** | In-chat streaming of codegen. Surfaces after BUILD intent passes Decision Catch. |
| **Extract to Forge** | Promotes a chat thread into a Forge session. Requires (or creates) a Ledger commit on entry. |
| **GitHub push / Export** | Ships committed work. Push action records itself back to the Ledger as a release entry. |

### Context & memory

- **DecisionDetailDrawer** — opens from a Ledger entry; shows original
  context, why it was made, what it affects, where it's been violated, what
  was built from it.
- **ActiveTensionCard** — "You are balancing: Speed ↔ Trust. Current tilt: Speed."
- **AtlasNoticedCard** — pattern detection.
- **OpenLoops** — unresolved thinking threads (NOT tasks).
- **ContextIngestionCard** — file ingestion responds with drift/alignment,
  not "here's what's in your file."
- **ConceptSketchCard** — image generation reframed as a thinking artifact.
  Refine / Accept Direction. Accepted sketches feed the Ledger as
  design-direction commitments and can hand off to Forge.

---

## 7. Reframings (Locked)

These capabilities exist and ship. Their **framing** is fixed.

### 7.1 Codegen, LivePreview, Forge — FIRST-CLASS, downstream

These are not demoted. They are real and they ship. The discipline is
ordering: Atlas does not spontaneously generate components during open
exploration. Once a build intent is clear (explicit `/forge`, `/build`,
"build this", or Decision Catch resolution that yields a build commit),
Forge and codegen are reached for immediately and without apology.

Auto-codegen on detected BUILD intent stays gated by the Decision Catch
trigger — if there's a conflict, catch first; otherwise build.

### 7.2 GitHub push — FIRST-CLASS

Atlas pushes to GitHub via the Git Tree API. A push is a build commitment
and records itself to the Ledger as a release entry. Never hidden, never
denied.

### 7.3 Image generation — REFRAMED as "Sketch"

The capability is real. The framing is fixed:

- **Wrong:** "Generate images." (commodity, loses)
- **Right:** "Clarify what you mean visually before committing to it."

The component is `ConceptSketchCard`. Output is a thinking artifact, not a
final asset. Two buttons: Refine / Accept Direction. Sketches that lead to
"Accept Direction" feed the Ledger as design-direction commitments and can
hand off to Forge.

### 7.4 File attachments — REFRAMED as Context Ingestion

- **Wrong:** "Atlas can read your stuff" (commodity, loses)
- **Right:** Atlas ingests context to detect drift from stated intent.

Atlas does NOT respond with "here's what's in your file." Atlas responds
with: *"This build is drifting from what you originally intended."* or
*"This contradicts the constraint you set in the Compass."* The output of
ingestion can fire a Decision Catch, surface a tension, feed the Ledger,
or hand off to Forge — but never a standalone "file insight" that
terminates nowhere.

---

## 8. Layout

Two top-level surfaces, both first-class:

- **War Room** (default) — Ledger · Conversation · Context. The
  think → decide loop happens here.
- **Workshop / Forge** — file tree · live generation · preview · diff ·
  GitHub push. The build loop happens here. Atlas remains present as a
  side panel and the Decision Catch continues to fire on build moves.

Entering Workshop is an intentional shift, not a demotion. The expected
path is War Room → commit → Workshop. Power users can jump straight to
Workshop via `/forge`; the Decision Catch still runs on any build action.

---

## 9. What "Done" Looks Like for the MVP

The decision spine + the build handoff ship as a unit. We know it works
when:

- **DecisionCatch fires on real intent.** If it never fires, the trigger
  is broken. If it fires on venting, the trigger is too loose.
- **Users engage with Proceed / Adjust.** If ignored, the tone is wrong.
- **The Ledger groups reflect reality.** If everything piles into
  Committed, the lifecycle isn't being respected.
- **Forge runs trace back to a Ledger entry.** If Forge runs orphaned —
  no commit, no link — the order has collapsed.
- **GitHub pushes appear in the Ledger as release entries.** If pushes
  are silent, the loop hasn't closed.
- **ThreadAnchor only updates on real shifts.**

---

## 10. What Does NOT Belong (Hard Stops)

- General-purpose chat with no Decision Catch wired in
- Image generation framed as a standalone hero feature
- File analysis framed as a standalone "here's what's in your file" feature
- Any feature whose primary value prop is "faster output with no commit trace"
- Any build action that does not either resolve from or create a Ledger entry
- Any copy that says "Atlas can't build that" or "I'm not able to write code"

---

## 11. Taglines & Voice Anchors

- *"A decision partner that ships."*
- *"Think. Decide. Build — in that order."*
- *"Move correctly, not just faster."*
- *"Thinking made visible."* (Sketch flow only)
- *"Where were we."* (anchor moment — exact phrasing)
- *"Before you do — …"* (Decision Catch lead-in — never deviate)

---

## 12. Build Order (Locked)

Phase A (now): Decision spine (ThreadAnchor, DecisionCatchCard, CommitPrompt,
grouped Ledger) + Forge/codegen wired so every run links to a Ledger entry
+ GitHub push recorded as a release entry.

Phase B: DecisionDetailDrawer (showing what was built from each commit),
ActiveTensionCard, AtlasNoticedCard, OpenLoops, Sketch flow, Context
Ingestion drift responses, Forge-from-Ledger one-click.

Phase C: Multi-AI orchestration (Constitution Section IX), advanced
pattern detection, cross-project memory, deeper Workshop polish.

---

*If a future decision conflicts with this document, this document wins
until it is explicitly updated. Update the date at the top when you do.*

## The Unified Experience Principle
The workspace is not a destination. It is a state. The conversation is always the root — tools, maps, forge, and files emerge from it contextually. Repos are mounted contexts, not identities. Atlas is primary. Everything else is secondary.
