# Atlas — Strategic Thinking Partner

## What It Is

Atlas is a decision enforcement system and strategic thinking partner for founders and builders. It is NOT a code builder — it helps you make decisions you won't regret, catches you when you're about to contradict yourself, and keeps a permanent record of every commitment you make.

**Core concept:** Atlas turns bought lessons into standard operating procedure. It shows up when you're about to override something you already committed to, and asks you to explain yourself first.

## Architecture

### Stack
- **Frontend:** React + Vite (`artifacts/atlas/`) at `/`
- **Backend:** Express 5 API server (`artifacts/api-server/`) at `/api`
- **Database:** Replit PostgreSQL via Drizzle ORM (`lib/db/`)
- **AI:** OpenAI via Replit AI Integrations (`lib/integrations-openai-ai-server/`)
- **API Contract:** OpenAPI spec + Orval codegen (`lib/api-spec/`, `lib/api-client-react/`, `lib/api-zod/`)

### Key Directories
```
artifacts/atlas/src/pages/
  home.tsx          — Front Door ("Where were we.", glass input, project list, BelowFoldDashboard)
  workspace.tsx     — Two-pane: left chat + right Decision Ledger canvas
  projects.tsx      — Project list (secondary, accessible via nav)
  ledger.tsx        — Full ledger view; breadcrumb nav, filter pills (ALL/STRUCTURE/AESTHETIC/LOGIC/GENERAL), three sections (committed/in-tension/overridden)
  parking-lot.tsx   — Parked ideas per project; RESUME/DELETE/COMMIT actions; project switcher dropdown

artifacts/atlas/src/components/
  ProjectsDrawer.tsx    — Left slide-in panel: projects list, navigate, Parking Lot link, tools, user footer
  UserMenuDropdown.tsx  — Avatar dropdown: Appearance toggle (moon/sun), Shortcuts, Edit profile, Sign out
  BelowFoldDashboard.tsx — Scroll-reveal below-fold: Atlas noticed, Your Momentum, Unfinished Thoughts, Where were we

artifacts/api-server/src/routes/
  projects.ts       — CRUD + summary stats
  sessions.ts       — Session management + message history
  entries.ts        — Decision Ledger entries
  chat.ts           — AI chat with Decision Catch Engine

lib/db/src/schema/
  projects.ts
  sessions.ts
  chat_messages.ts
  entries.ts
```

## Session Memory System

Three-layer persistent memory so Atlas never loses context between sessions:

### 1. Project Memory (Database)
- `memory` column on `projects` table — a running log of durable facts Atlas learns about each project
- Injected into the system prompt at the start of every chat: "--- PROJECT MEMORY ---"
- AI writes new facts during sessions using `PROJECT_MEMORY: [one sentence]` protocol
- Facts are auto-stripped from visible response, timestamped `[YYYY-MM-DD]`, and appended to the DB
- View/edit/clear in the **Memory tab** of the right panel

### 2. User Profile (localStorage)
- Stored as `atlas-user-profile` in localStorage: name, stack, projects list, notes
- Edit via the **P avatar button** in the workspace header (opens profile panel)
- Sent as `userProfile` with every chat request → injected as "--- WHO YOU'RE WORKING WITH ---"
- Pre-filled defaults: React/Tailwind/Supabase stack, all 6 project names

### 3. AI Memory Protocol
- AI instructed to emit `PROJECT_MEMORY: [fact]` for durable project-specific discoveries
- Chat route parses, strips from visible output, and persists to DB automatically
- One fact per response max — only for things worth knowing next session

## Core Features

### Decision Catch Engine
The brain of Atlas. When you say something that contradicts a committed decision, Atlas intercepts with a structured card:
1. Shows the lead sentence explaining the tension
2. First click: "Proceed anyway" → reveals a reason textarea
3. After typing reason: "Confirm" → logs a deviation entry to the ledger
4. "Adjust" (gold button) → clears the catch and refocuses the input

Implemented in `artifacts/api-server/src/routes/chat.ts`. AI returns `DECISION_CATCH:{...}` JSON in its response, parsed and rendered as a catch card inline in the chat.

### Decision Ledger (Right Canvas Panel)
- Live view of all committed and parked decisions for the active project
- Updates automatically when catches are resolved or decisions added manually
- "+ Add" button for adding decisions directly from the canvas panel
- Active catch highlighted in the canvas when one fires

### Invisible Modes
Think / Plan / Build / Explore / Decide / Audit exist in the AI logic but are **not visible in the UI**. Atlas detects intent from what the user types and responds accordingly. Mode is always sent as "think" from the client; the AI infers the real mode from context.

## Design System

### Themes
Two themes are supported. Theme is toggled via the avatar dropdown → Theme section. Persisted in `localStorage` as `atlas-theme` and applied as `data-theme="parchment"` on `<html>`.

- **Obsidian** (default/dark): Deep black-brown obsidian — original volcanic identity
- **Parchment** (light): Warm cream / cognac — readable field-notes aesthetic

### Identity tokens (CSS custom properties)
Obsidian values (Parchment overrides defined in `[data-theme="parchment"]`):
```css
--atlas-bg:          #0C0A09   /* True obsidian — the darkest surface */
--atlas-surface:     #1C1917   /* Raised panels */
--atlas-surface-alt: #161412   /* Right canvas background */
--atlas-fg:          #E7E5E4   /* Primary text */
--atlas-muted:       #78716C   /* Muted / secondary text */
--atlas-ember:       #92400E   /* Deep bronze amber — Decision Catch, send button */
--atlas-gold:        #C9A24C   /* Accent gold — Ledger, Atlas label, borders */
--atlas-border:      #252220   /* Subtle dividers */
```

CSS alias tokens (for original component compatibility):
```css
--ember, --accent-gold, --surface, --foreground, --border, --background, --muted-text
```

### Key CSS classes
- `.atlas-input-shell` — Glass input with breathing gold border animation
- `.atlas-think-dots` — Three pulsing gold dots for AI thinking state
- `.atlas-bubble-in` — Slide-up animation for new messages
- `.atlas-catch-card` — Ember-tinted card for Decision Catch
- `.atlas-resize-handle` — Drag handle between the two panes
- `.atlas-send-btn` — Send button (ember when active, muted when empty)

### Typography
- Sans: Geist (CDN import)
- Mono: Geist Mono (CDN import) — used for labels, timestamps, mode indicators

## UI Flow

### Front Door (`/`)
1. "Where were we." greeting + rotating placeholder text
2. Glass input with breathing gold border — type to start, Enter to navigate
3. If text is entered, it is stored in `sessionStorage` and sent as the first message in workspace
4. Project list below — click to open any project's workspace
5. "+ New project" creates a project and navigates directly to its workspace

### Workspace (`/project/:id`)
- **Left pane** (resizable, default 520px): chat history + glass input at bottom
- **Drag handle**: resize between panes, double-click for 50/50 split
- **Right pane** (flex-1, min 240px): Decision Ledger canvas
  - Header: "Decision Ledger" label + count badge + "+ Add" button
  - Active catch indicator when a Decision Catch is triggered
  - Committed entries (gold dot) and Parked entries (muted dot)
- Header: Atlas logo (→ home), project name, "Session active" indicator

## Four-Phase Roadmap

- **Phase 1 (Connect + Read)**: ~70% done — GitHub browser, file tree, file context in chat, per-project repo auto-link. Gap: AI only sees files you manually open; must manually link each of 6 repos once.
- **Phase 2 (Apply Edits)**: 0% — diff generation + GitHub write-back (create commit/PR). Needs GitHub write API routes.
- **Phase 3 (Understand)**: 0% — route/component/table mapping, auto-generated project overview. Session memory (pre-Phase 2) is now complete.
- **Phase 4 (Live Preview)**: 0% — real running app in iframe (not typed URL).

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection (auto-provisioned by Replit)
- `ANTHROPIC_API_KEY` — Claude sonnet-4-6 for AI chat
- `GOOGLE_GEMINI_API_KEY` — Gemini for image generation

## Development Commands
```bash
# Run codegen after OpenAPI spec changes
pnpm --filter @workspace/api-spec run codegen

# Push DB schema changes
pnpm --filter @workspace/db run push

# Typecheck the frontend
pnpm --filter @workspace/atlas run typecheck

# Rebuild API server
pnpm --filter @workspace/api-server run build
```

## Reference
Original Atlas codebase: `jochanae/atlas` — built on Lovable (TanStack Start, Supabase). This rebuild uses the same product vision on Replit's native stack, with a cleaner two-pane design and invisible mode detection.
