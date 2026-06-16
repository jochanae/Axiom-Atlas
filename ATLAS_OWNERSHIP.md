# ATLAS OWNERSHIP
*What Atlas owns versus what Atlas integrates with.*
*The question that was never named — until now.*

---

## Why this document exists

Previous Atlas architecture slowly allowed integrations to become dependencies.

That is where Atlas got over-connected.

This document names the line clearly, permanently, before any architecture decision is made.

---

## What Atlas owns

These things are Atlas. They cannot be outsourced, replaced, or made optional.

**If Atlas cannot temporarily operate without this capability, Atlas must own it.**

- **The conversation** — the primary interface between user and Atlas
- **The project** — the durable record of what is being built
- **Builder orchestration** — directing what gets built and how
- **Project continuity** — memory across sessions, the "don't start over" promise
- **Decisions** — the record of what was decided and why
- **The user experience** — how it feels, looks, and responds

---

## What Atlas integrates with (optionally)

These things are infrastructure. They are useful. They are not Atlas.

If any of these change or disappear, Atlas adapts.

- GitHub — optional connection for code persistence
- External databases — Atlas uses one, but is not coupled to a specific provider
- Deployment providers — where things run is not Atlas's identity
- Third-party APIs — tools Atlas can call, not things Atlas depends on
- External file systems — Atlas can read and write, but does not require them

---

## The rule

**If Atlas cannot temporarily operate without this capability, Atlas must own it.**

**If Atlas can survive without it, Atlas integrates with it.**

Ownership means responsibility, not fragility.

---

## The Atlas Test

Before adding any new technology, answer three questions in order.

**1. Is this Atlas?**
If yes → Atlas owns it. Build it inside Atlas's controlled environment.
If no → continue.

**2. Is this infrastructure?**
If yes → Atlas integrates with it. Wire it in. Never let Atlas depend on it to function.
If no → continue.

**3. Is this replacing a broken foundation?**
If yes → stop. Fix the foundation first. Do not build around the problem.

**Atlas no longer builds around weaknesses. Atlas strengthens foundations.**

---

## What this means in practice

When someone proposes adding something to Atlas, ask:

> Is this something Atlas owns, or something Atlas integrates with?

If it belongs in the "owns" column — build it properly, inside Atlas's controlled environment.

If it belongs in the "integrates with" column — treat it as optional infrastructure. Wire it in. But never let Atlas depend on it to function.

---

## The mistake that happened before

GitHub went from integration → dependency.
Supabase went from integration → dependency.
Cloud Run went from infrastructure → identity.

When integrations become dependencies, they become architecture.
When they become architecture, they become unfixable.

**This document exists to prevent that from happening again.**

---

## The portability principle

Atlas should never be coupled to an environment.

Five years from now, Replit may not be the answer.
Neither may Supabase. Neither may Vercel.

But Atlas should survive them all.

**Atlas should own Atlas. Everything else is infrastructure.**

---

## The full document progression

| Document | What it answers |
|---|---|
| **Atlas Zero** | What is Atlas? What are its boundaries? |
| **Atlas One** | What does the first successful experience look like? |
| **Atlas Foundation** | What minimum systems are required? |
| **Atlas Ownership** | What does Atlas own vs. integrate with? |
| **Atlas Architecture** | What single environment can execute these systems while keeping Atlas portable? |

**No architecture decisions before all five documents are written.**

Not: "no repo until documents are perfect." The real rule is:
**No architecture before clarity.**
