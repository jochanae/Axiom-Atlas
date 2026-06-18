# ATLAS MANIFEST
*Flow 3 Specification — The Builder Engine*
*Written June 17, 2026*

> **If code, endpoints, or conversations conflict with this document, this document wins.**

---

## The governing principle

Flow 3 does not mean "build the whole app."

It means: choose the smallest useful manifestation, select the lightest appropriate engine, and make the idea visible enough for the user to react to.

**The north star:**
> The right thing. At the right fidelity. With the lightest possible engine.

---

## What Flow 3 is responsible for

Flow 3 is the Bridge between a committed project and a tangible experience.

It owns exactly three decisions:
1. **Is this project ready to manifest?** (Manifest Score)
2. **What is the first thing that must exist?** (First Artifact Decision)
3. **Which engine is the right tool for that thing?** (Engine Selection)

Flow 3 is NOT responsible for:
- Building the entire project
- Managing GitHub repositories
- Handling deployments
- Writing production code
- Making infrastructure decisions the user hasn't asked for

---

## What "manifest" means in Axiom

To manifest is to make an idea visible enough to react to.

Not to ship. Not to deploy. Not to hand off to engineering.

**Manifestation is successful when the user can say:**
> "Yes, that's what I meant."
> or
> "No — not quite. Let me show you."

Either response is a win. The goal is to produce a reaction, not a product.

---

## Manifest Score

Before Flow 3 begins, Atlas scores the project against five criteria.

Each criterion is binary: present or not present.

| Criterion | Question Atlas asks |
|---|---|
| **Promise** | Do we know what this does for the user? |
| **Primary user** | Do we know who uses it first? |
| **Input** | Do we know what the user gives the system? |
| **Output** | Do we know what the system returns to the user? |
| **Core moment** | Do we know the single moment where the idea becomes real? |

**Scoring rule:**
- Score ≥ 5 → Proceed to manifestation
- Score < 5 → Return to workspace. Name what's missing.

**What Atlas does NOT score:**
- Engineering unknowns (database choices, APIs, hosting)
- Business model
- Scale
- Edge cases
- Long-term architecture

Engineering unknowns are explicitly ignored at manifest time. They are not the user's problem at this stage.

---

## What project context is required

To run the Manifest Score and make the First Artifact Decision, Atlas needs:

| Context field | Source |
|---|---|
| Project name | `projects.name` |
| Project description | `projects.description` |
| Project memory | `projects.memory` — extracted decisions, identity, constraints |
| Conversation summary | Last N messages from the workspace session |
| Existing nodes | From the Flow canvas (requirements, decisions, blockers, sprints) |

Atlas does NOT need:
- GitHub repository
- Codebase
- Existing files
- Deployment configuration

The project memory and conversation are sufficient to make a manifest decision.

---

## How Atlas chooses the First Artifact

The First Artifact is not "the app." It is the single smallest experience that proves the core moment.

Atlas arrives at the First Artifact by asking one question:

> What is the first thing that must exist for this idea to become believable?

**Rules for the First Artifact:**
1. It is one screen, one flow, or one interaction — not multiple
2. It proves the core moment, not the full product
3. It requires no infrastructure the user hasn't asked for
4. It is described as an experience, not a feature list

**Example — Exterior Transform:**

| ❌ Wrong first artifact | ✅ Right first artifact |
|---|---|
| The full application | The upload experience |
| User accounts | The visualization reveal |
| Contractor integrations | The Reality Check card |
| Database | The first action prompt |

The wrong answer builds the whole thing.
The right answer builds the moment where the idea becomes real.

---

## Engine selection rules

Once the First Artifact is decided, Atlas selects the lightest engine that can render it.

### Atlas Generated
**Use when:**
- Single screen
- Single workflow
- UI concept validation
- Interaction proof
- No shared state needed

**Output:** Standalone React component rendered as a live HTML page via `/api/preview/component`

**Examples:**
- Upload photo screen
- Visualization reveal
- Pricing calculator
- Onboarding card
- Single form flow

---

### Sandbox
**Use when:**
- Self-contained component with internal logic
- No external dependencies
- Fast, isolated experimentation

**Examples:**
- Cost estimator widget
- DIY/Pro calculator
- Upload card with drag-and-drop

---

### StackBlitz
**Use when:**
- Multiple screens exist
- Shared state is required
- Small app skeleton needed (4–5 connected screens)

**Examples:**
- Multi-step onboarding
- Dashboard with navigation
- Connected form + results view

---

### Local Dev
**Use when:**
- Real engineering has begun
- APIs or services are required
- File system access is needed
- The user has explicitly moved past prototype

---

### Live URL
**Use when:**
- The user explicitly requests deployment
- Something already exists at a URL and needs updating

---

**Engine selection is a decision, not an option menu.**
Atlas selects one engine and states why. The user does not pick from a list.

---

## The Manifestation Decision card

Before Atlas generates anything, it announces its decision.

This announcement is not a confirmation prompt. It is a visible reasoning statement.

**Format:**

```
Manifestation Decision

[Project Name]

Manifest Score: [X/5]
First artifact: [Name of the specific screen/flow/interaction]
Engine chosen: [Engine name]
Reason: [One sentence — why this engine, why this artifact]

Building:
1. [Step one of the experience]
2. [Step two]
3. [Step three]
...

Estimated complexity: [Low / Medium / High]
Deployment required: [Yes / No]
```

**Example:**

```
Manifestation Decision

Exterior Transform

Manifest Score: 5/5
First artifact: The core homeowner upload experience
Engine chosen: Atlas Generated
Reason: This product wins or loses on confidence, not infrastructure.

Building:
1. Upload photo screen
2. Describe your project
3. Visualization reveal
4. Reality Check card
5. First Action prompt

Estimated complexity: Low
Deployment required: No
```

**What the card must NOT do:**
- Ask the user what to build
- List options for the user to choose from
- Request confirmation before proceeding
- Explain the decision at length

The card is a statement. Atlas has already decided. The user can redirect, but the default is to proceed.

---

## What should NOT happen in Flow 3

These are explicit anti-patterns. If any of these occur, Flow 3 has failed.

| Anti-pattern | Why it fails |
|---|---|
| Atlas asks "What should I build?" | Atlas owns the manifest decision |
| Atlas builds the entire application | First artifact is always a single experience |
| Atlas skips the Manifestation Decision card | The decision must be visible |
| Atlas picks a heavier engine when a lighter one works | Lightest sufficient engine always wins |
| Atlas begins building before scoring ≥ 5 | Clarity gates manifestation |
| Atlas deploys without being asked | Deployment is not a default action |
| Atlas generates infrastructure (DB, auth, API) unprompted | Those belong to Flow 4+ |
| Atlas silently generates output | Every generation is announced |

---

## How this connects to existing infrastructure

### `preview.ts` — The Atlas Generated renderer
`POST /api/preview/component` accepts React component code and returns a standalone HTML page with React loaded from CDN. No build step. No deployment. This IS the Atlas Generated engine.

`GET /api/preview/session/:sessionId` renders the latest FILE_EDIT blocks from a session as a live preview. This is the session-based preview path.

**Flow 3 uses `preview.ts` as the output surface for Atlas Generated manifests.**

### `codegen.ts` — The generation engine
`POST /api/codegen` takes a prompt and project context, calls Claude, returns a complete working file. Clean, functional, ready to use.

**Flow 3 uses `codegen.ts` to generate the component that `preview.ts` renders.**

### The missing piece
Neither `preview.ts` nor `codegen.ts` makes any decisions. They execute. Flow 3 needs the layer that decides what to execute and why.

That layer is `POST /api/manifest/decide`.

---

## `POST /api/manifest/decide` — What it should do

*Planning section — endpoint not yet built.*

**Input:**
```json
{
  "projectId": number,
  "sessionId": number
}
```

**Process:**
1. Load project (name, description, memory, nodes)
2. Load recent conversation messages
3. Run Manifest Score against five criteria
4. If score < 5: return what's missing, do not proceed
5. If score ≥ 5: determine First Artifact from project context
6. Apply engine selection rules → select one engine
7. Construct Manifestation Decision object

**Output:**
```json
{
  "manifestScore": number,
  "scoreBreakdown": {
    "promise": boolean,
    "primaryUser": boolean,
    "input": boolean,
    "output": boolean,
    "coreMoment": boolean
  },
  "ready": boolean,
  "missingCriteria": string[],
  "firstArtifact": {
    "name": string,
    "description": string,
    "steps": string[]
  },
  "engine": "atlas-generated" | "sandbox" | "stackblitz" | "local-dev" | "live-url",
  "engineReason": string,
  "complexity": "low" | "medium" | "high",
  "deploymentRequired": boolean
}
```

**If ready is false:** The response is returned to the workspace as a message telling the user what's missing before Flow 3 can proceed.

**If ready is true:** The response is rendered as the Manifestation Decision card in the workspace chat, and generation proceeds.

---

## The sequence

```
User: "Build it." (or equivalent)
        ↓
POST /api/manifest/decide
        ↓
Manifest Score computed
        ↓
Score < 5 → Return to workspace with missing criteria
Score ≥ 5 → Continue
        ↓
First Artifact determined
        ↓
Engine selected
        ↓
Manifestation Decision card rendered in workspace
        ↓
POST /api/codegen (with first artifact as prompt + project context)
        ↓
POST /api/preview/component (with generated code)
        ↓
Preview URL returned → rendered in workspace as iframe
        ↓
User reacts
```

---

*This document is the source of truth for Flow 3.*
*No endpoint, no prompt, no UI decision for Flow 3 should conflict with this spec.*
*When in doubt: lightest engine. Smallest artifact. Visible decision.*
