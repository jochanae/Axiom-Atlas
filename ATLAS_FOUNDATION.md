# ATLAS FOUNDATION
*The minimum systems required for Atlas to keep its promise.*

---

## The rule before anything else

**Every system must be independently shippable before the next system begins.**

Not planned. Not drafted. Not partially built. **Shipped.**

---

## System 1: Conversation Engine

**Purpose:** Allow a user to arrive with nothing but an idea.

User can:
- Open Atlas
- Begin talking
- Ask questions
- Explore ideas
- Be understood

Atlas can:
- Hold context within the session
- Ask clarifying questions
- Extract intent

**Success test:** A user can say "I have an idea." and Atlas can help them understand it.

Do NOT build yet: memory, blueprints, artifacts, GitHub, builder systems.

---

## System 2: Project Engine

**Purpose:** Turn conversations into projects.

User can:
- Talk naturally until Atlas says: *"I think we have a project."*

Atlas can generate:
- Project title
- Project purpose
- Project summary
- Current state

**Success test:** Conversation becomes a durable project.

Do NOT build yet: complex lifecycle states, Atlas Pulse, shaping/committed/built states, portfolio relationships.

---

## System 3: Builder Engine

**Purpose:** Turn projects into something real.

User can say: *"Build it."*

Atlas can generate:
- UI
- Logic
- Data structures

**Success test:** Something tangible exists.

Do NOT build yet: diff viewers, file editors, advanced builders.

---

## System 4: Runtime Engine

**Purpose:** The thing actually works.

User can:
- Open it
- Click it
- Use it

**Success test:** The user experiences their idea.

Do NOT build yet: StackBlitz, GitHub, multiple deployments.

---

## System 5: Continuity Engine

**Purpose:** The user never starts over.

Atlas can remember:
- The project
- Decisions
- Direction

User can say: *"Let's keep going."*

**Success test:** No re-explaining. No restarting.

Do NOT build yet: complex memory architectures, portfolio intelligence, advanced relationship graphs.

---

## What comes before building this

Before a single line of code, one decision must be made.

**What is the single environment that owns all five systems?**

This is the most important decision in Atlas's history.

Atlas didn't fail because of code quality.
**Atlas failed because no single environment owned the entire experience.**

Get that decision right, and 70% of the frustration from the last two years disappears before the first feature is written.

---

## The four documents together

| Document | What it does |
|---|---|
| **Atlas Zero** | Establishes the philosophy, the boundaries, the promise. |
| **Atlas One** | Describes the first successful experience. The test every feature must pass. |
| **Atlas Foundation** | Names the minimum systems required. In order. Nothing extra. |
| **Atlas Architecture** | Decides where Atlas lives. The single environment decision. |

*Atlas Zero told us what Atlas is.*
*Atlas One told us what Atlas does.*
*Atlas Foundation tells us what Atlas needs.*
*Atlas Architecture will tell us where Atlas lives.*
