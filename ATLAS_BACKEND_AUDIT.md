# ATLAS BACKEND AUDIT
*Factual snapshot — June 16, 2026. No fixes. No opinions. Just what exists.*

---

## 1. Auth System

**What's active:** Custom session-based auth. No Passport, no NextAuth, no Supabase Auth.

**How it works:**
- Login/signup → backend issues a random token → stored in `userSessionsTable`
- Token delivered two ways:
  - **Cookie:** `atlas-session` (httpOnly, secure, sameSite:"none", 90-day expiry)
  - **Bearer header:** `Authorization: Bearer <token>` (fallback for cross-domain)
- `requireAuth` middleware checks cookie first, then Bearer header
- `GET /api/auth/session/exchange?token=…` — converts a one-time URL token into a full session cookie (used after OAuth redirect)

**Google OAuth flow:**
1. `GET /api/auth/google` → redirects to Google consent
2. Google redirects to `GET /api/auth/google/callback`
3. Backend creates/finds user, issues session token
4. Redirects to frontend `/token-bridge?token=<token>` (dynamic redirect URI — reads `x-forwarded-host` header, then `APP_URL` env var)
5. Frontend calls `/api/auth/session/exchange?token=…` to upgrade token → cookie

**Registered redirect URI in Cloud Run:** `https://axiom-atlas-689827072865.us-east1.run.app/api/auth/google/callback`

---

## 2. CORS — Allowed Origins

| Origin | Source |
|---|---|
| `https://axiomsystem.app` | hardcoded |
| `https://www.axiomsystem.app` | hardcoded |
| `https://axiom-atlas-mocha.vercel.app` | hardcoded |
| `https://lovable.dev` | hardcoded |
| `https://5360bfd7-...lovableproject.com` | hardcoded (Lovable project ID) |
| `https://atlas-idk.vercel.app` | hardcoded |
| `https://atlas-iq.lovable.app` | hardcoded |
| `http://localhost:5173` / `localhost:3000` | hardcoded |
| `*.replit.dev`, `*.replit.app` | regex |
| `*.lovable.app`, `*.lovableproject.com` | regex |
| `*.vercel.app` | regex |
| `localhost:*` | regex |
| `APP_URL`, `REPLIT_DOMAINS`, `RAILWAY_PUBLIC_DOMAIN` | env var |

**`credentials: true` is set.** Cookies will be sent cross-origin to any allowed origin.

---

## 3. Database Tables (28 total in Drizzle schema)

| Table | Purpose | In Supabase? |
|---|---|---|
| `users` | User accounts | ✅ Confirmed |
| `user_sessions` | Auth tokens | ✅ Confirmed |
| `projects` | Project records | ✅ Confirmed |
| `sessions` | Workspace chat sessions | ✅ Confirmed |
| `chat_messages` | Message history | ✅ Confirmed |
| `entries` | Decision Ledger entries | ✅ Confirmed |
| `nexus_messages` | Home chat messages | ✅ Confirmed |
| `thoughts` | Parking lot ideas | ✅ Confirmed |
| `vault` | Secrets vault | ✅ Confirmed |
| `secrets` | Per-project secrets | ✅ Confirmed |
| `invites` | Invite codes | ✅ Assumed |
| `readiness_snapshots` | Project readiness history | ✅ Assumed |
| `gallery` | Image gallery | ✅ Assumed |
| `forgeState` | Forge persistence | ✅ Assumed |
| `flowCanvas` | Master Map canvas | ✅ Assumed |
| `connections` | External service connections | ✅ Assumed |
| `mcp_connections` | MCP server connections | ✅ Assumed |
| `image_versions` | Image generation history | ✅ Assumed |
| `scheduled_checks` | Browser monitor schedules | ✅ Assumed |
| `atlas_incidents` | System incident log | ✅ Assumed |
| `atlas_error_logs` | Frontend error ingestion | ✅ Assumed |
| `atlas_self_map` | Self-map entries | ✅ Assumed |
| `generation` | Code generation records | ✅ Assumed |
| `conversations` / `messages` | Legacy (possibly unused) | ❓ Unknown |
| `admin` | Admin records | ✅ Assumed |
| `blueprints` | Blueprint records | ❌ **MISSING from Supabase** |
| `artifacts` | Artifact records | ❌ **MISSING from Supabase** |

---

## 4. Full Route Inventory

### PUBLIC (no auth required)

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/health` | Health check | ✅ Working |
| GET | `/api/healthz` | Simple liveness | ✅ Working |
| POST | `/api/auth/signup` | Email/password signup | ✅ Working |
| POST | `/api/auth/login` | Email/password login | ✅ Working |
| POST | `/api/auth/logout` | Clear session cookie | ✅ Working |
| GET | `/api/auth/session/exchange` | Upgrade OAuth token → cookie | ✅ Working |
| POST | `/api/auth/forgot-password` | Send reset email (Resend) | ✅ Working |
| POST | `/api/auth/reset-password` | Apply new password | ✅ Working |
| GET | `/api/auth/google` | Start Google OAuth | ✅ Working |
| GET | `/api/auth/google/callback` | Google OAuth callback | ✅ Working |
| GET | `/api/auth/google/redirect-uri` | Diagnostic: shows registered URI | ✅ Working |
| GET | `/api/auth/dev-test-login` | Dev-only test login | Dev only |
| POST | `/api/errorlog/ingest` | Frontend error ingestion | ✅ Working |
| POST | `/api/stripe/webhook` | Stripe billing events | ✅ Working |
| GET | `/api/storage/*` | Object storage serve | ✅ Working |

### PROTECTED (requireAuth)

**Projects**
| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/projects` | List user projects | ✅ Working |
| POST | `/api/projects` | Create project | ✅ Working |
| GET | `/api/projects/recent` | Recent projects | ✅ Working |
| GET | `/api/projects/:id` | Get single project | ✅ Working |
| PATCH | `/api/projects/:id` | Update project (title, status, etc.) | ✅ Working |
| DELETE | `/api/projects/:id` | Delete project | ✅ Working |
| POST | `/api/projects/:id/touch` | Update lastActiveAt | ✅ Working |
| GET | `/api/projects/:id/summary` | AI-generated summary | ✅ Working |
| POST | `/api/projects/:id/memories` | Write project memory | ✅ Working |
| POST | `/api/projects/:id/clone` | Clone project | ✅ Working |
| GET/PUT | `/api/projects/:id/shape` | Project shape data | ✅ Working |
| GET | `/api/projects/:id/map-nodes` | Flow map nodes | ✅ Working |
| GET | `/api/projects/:id/greeting` | AI project greeting | ✅ Working |
| GET/PUT | `/api/projects/:id/flow` | Flow canvas data | ✅ Working |
| GET/POST | `/api/projects/:id/readiness-snapshots` | Readiness history | ✅ Working |

**Sessions**
| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/projects/:projectId/sessions` | List sessions | ✅ Working |
| POST | `/api/projects/:projectId/sessions` | Create session | ✅ Working |
| GET | `/api/projects/:projectId/runs` | Session runs list | ✅ Working |
| GET | `/api/sessions/:id` | Get session + messages | ✅ Working |
| PATCH | `/api/sessions/:id` | Update session | ✅ Working |
| DELETE | `/api/sessions/:id` | Delete session | ✅ Working |
| POST | `/api/sessions/:id/reflection-mode` | Toggle reflection | ✅ Working |
| POST | `/api/sessions/:id/idea-mode` | Toggle idea mode | ✅ Working |

**Chat (Workspace)**
| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/api/chat` | Workspace AI chat (Claude/Gemini) + Decision Catch + FILE_EDIT | ✅ Working |
| POST | `/api/quick-prompt` | Quick inline prompt | ✅ Working |
| POST | `/api/scenario-keep` | Keep scenario decision | ✅ Working |

**Nexus (Home chat)**
| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/api/nexus/chat` | Home AI chat (model-aware) | ✅ Working |
| POST | `/api/nexus/briefing` | Portfolio briefing generation | ✅ Working |
| GET | `/api/nexus/activity` | Recent activity feed | ✅ Working |
| GET/DELETE | `/api/nexus/thread` | Current thread | ✅ Working |
| POST | `/api/nexus/conversation/save` | Save conversation | ✅ Working |
| GET | `/api/nexus/conversations` | List saved conversations | ✅ Working |
| GET | `/api/nexus/conversation/:id` | Get conversation | ✅ Working |
| POST | `/api/nexus/handoff` | Hand off to workspace | ✅ Working |
| POST | `/api/nexus/name` | Name a conversation | ✅ Working |

**Decision Ledger (Entries)**
| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/entries/all` | All entries (cross-project) | ✅ Working |
| GET | `/api/projects/:projectId/entries` | Project entries | ✅ Working |
| POST | `/api/projects/:projectId/entries` | Create entry | ✅ Working |
| GET | `/api/entries/:id` | Get entry | ✅ Working |
| PATCH | `/api/entries/:id` | Update entry | ✅ Working |
| DELETE | `/api/entries/:id` | Delete entry | ✅ Working |
| POST | `/api/entries/:id/context` | Add context | ✅ Working |
| POST | `/api/entries/:id/reopen` | Reopen entry | ✅ Working |

**Blueprints** *(routes exist — table missing from Supabase)*
| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/projects/:id/blueprints` | List blueprints | ❌ Table missing |
| GET | `/api/projects/:id/blueprints/:blueprintId` | Get blueprint | ❌ Table missing |
| POST | `/api/projects/:id/blueprint` | Generate blueprint (AI) | ❌ Table missing |

**Artifacts** *(routes exist — table missing from Supabase)*
| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/artifacts` | List artifacts (by projectId query param) | ❌ Table missing |
| POST | `/api/artifacts` | Create artifact | ❌ Table missing |
| PATCH | `/api/artifacts/:id` | Update artifact | ❌ Table missing |

**GitHub**
| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/github/tree` | Fetch file tree | ✅ Working (public repos) |
| POST | `/api/github/file` | Read file content | ⚠️ Fails on private repos w/o user token |
| POST | `/api/github/write` | Write file (requires user token) | ✅ Working (with user token) |
| POST | `/api/github/analyze` | Analyze repo structure | ✅ Working |
| POST | `/api/github/full-import` | Full repo import → memory + ledger | ✅ Working |
| GET | `/api/github/auto-link` | Auto-link repo to project | ✅ Working |

**Builder / Runtime**
| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/api/devserver/start` | Clone repo + start dev server | ✅ Working |
| GET | `/api/devserver/status` | Dev server status | ✅ Working |
| POST | `/api/devserver/stop` | Kill dev server | ✅ Working |
| POST | `/api/devserver/build-check` | Run build check | ✅ Working |
| GET | `/api/preview/session/:sessionId` | Render FILE_EDIT as live preview | ⚠️ Auth broken (cross-origin cookie) |
| POST | `/api/preview/component` | Render single component | ✅ Working |

**Image Generation**
| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/api/image/generate` | Gemini Imagen 3 + DALL·E fallback | ✅ Working |
| POST | `/api/imagine` | Alias/variant | ✅ Working |

**Forge / Strategy**
| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/api/forge` | Strategic extraction engine | ✅ Working |

**Browser Agent**
| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/api/browser/screenshot` | Screenshot a URL | ❓ Unknown |
| POST | `/api/browser/scrape` | Scrape page content | ❓ Unknown |
| POST | `/api/browser/health` | Check URL health | ❓ Unknown |
| POST | `/api/browser/monitor` | Set up monitoring | ❓ Unknown |
| POST | `/api/browser/schedule` | Schedule a check | ❓ Unknown |
| DELETE | `/api/browser/schedule/:id` | Delete scheduled check | ❓ Unknown |
| GET | `/api/browser/checks/:projectId` | List scheduled checks | ❓ Unknown |

**Deploy**
| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/api/deploy` | Trigger deployment | ❓ Unknown |
| GET | `/api/deploy/status` | Deployment status | ❓ Unknown |
| GET | `/api/deploy/after-push` | Post-push hook | ❓ Unknown |

**MCP**
| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/mcp/connections` | List MCP connections | ❓ Unknown |
| POST | `/api/mcp/discover` | Discover MCP server | ❓ Unknown |
| POST | `/api/mcp/connect` | Connect MCP server | ❓ Unknown |
| DELETE | `/api/mcp/connections/:id` | Disconnect | ❓ Unknown |

**Also registered:** thoughts, vault, secrets, connections, scan, tensions, import, selfmap, forge-state, stats, admin, invites, gallery, storage, terminal, codegen, state, errors, self (super_admin only)

---

## 5. Full User Journey Trace

*User logs in → opens Atlas → sends message → project created → Atlas responds → user returns*

| Step | Frontend file | Backend route | Database | Status |
|---|---|---|---|---|
| User opens `/login` | `login.tsx` | — | — | ✅ |
| User clicks Google | `login.tsx` | `GET /api/auth/google` | — | ✅ |
| Google redirects back | `token-bridge.tsx` | `GET /api/auth/google/callback` | `users`, `user_sessions` | ✅ |
| Token exchanged for cookie | `token-bridge.tsx` | `GET /api/auth/session/exchange` | `user_sessions` | ✅ |
| User lands on `/home` | `home.tsx` | `GET /api/auth/me` | `users` | ✅ |
| Briefing loads | `home.tsx` | `POST /api/nexus/briefing` | `projects` | ✅ |
| User sends message | `home.tsx` | `POST /api/nexus/chat` | `nexus_messages` | ✅ |
| User opens workspace | `workspace.tsx` | `GET /api/projects/:id` | `projects` | ✅ |
| Workspace loads session | `workspace.tsx` | `GET /api/projects/:id/sessions` | `sessions` | ✅ |
| User sends workspace message | `workspace.tsx` | `POST /api/chat` | `sessions`, `chat_messages` | ✅ |
| Decision caught | `workspace.tsx` | (inline in `/api/chat` response) | `entries` | ✅ |
| User returns next day | `workspace.tsx` | `GET /api/sessions/:id` | `sessions`, `chat_messages` | ✅ |
| **User opens BLUEPRINTS tab** | `BlueprintsTab.tsx` | `GET /api/projects/:id/blueprints` | `blueprints` | ❌ Table missing |
| **User opens ARTIFACTS tab** | `ArtifactsPanel.tsx` | `GET /api/artifacts?projectId=…` | `artifacts` | ❌ Table missing |

---

## 6. Specific Questions Answered

**Q1: What frontend origin is allowed by CORS?**
`axiomsystem.app` (the live site) is explicitly hardcoded. All `*.lovable.app`, `*.lovableproject.com`, `*.vercel.app` are allowed via regex. Credentials (`withCredentials`) will work from `axiomsystem.app`.

**Q2: What auth system is active?**
Custom. Random token → `userSessionsTable`. Cookie (`atlas-session`) + Bearer token fallback. No third-party auth library.

**Q3: What exact token/cookie does the backend issue?**
Cookie name: `atlas-session`. httpOnly, secure, sameSite:"none", 90-day expiry. Also accepted as `Authorization: Bearer <token>` header.

**Q4: What URL does Google OAuth redirect to?**
`https://axiom-atlas-689827072865.us-east1.run.app/api/auth/google/callback` (dynamic — reads `x-forwarded-host` in Cloud Run)

**Q5: What Supabase tables does the backend depend on?**
All 28 schema tables. Critically: `users`, `user_sessions`, `projects`, `sessions`, `chat_messages`, `entries`, `nexus_messages`. **Missing: `blueprints`, `artifacts`.**

**Q6: Which frontend routes does the backend assume exist?**
- `/token-bridge` — OAuth redirect lands here
- `/login` — auth failures redirect here
- `/home` — post-auth destination

**Q7: Which features are implemented backend but not connected to frontend?**
- Browser agent (screenshot, scrape, monitor) — routes built, no frontend UI confirmed
- Deploy routes — built, frontend connection unknown
- MCP connections — built, frontend connection unknown
- Forge state — built, frontend connection partial
- Scan/tensions/selfmap — built, usage unknown

**Q8: Which frontend-requested routes do not exist?**
Based on the audit — none. Every route the frontend calls exists in the backend.
The real gap is **Supabase** missing `blueprints` and `artifacts` tables.

---

## 7. Classification for Atlas Architecture Decision

| System | Keep as-is | Repair | Rebuild | Remove from Phase 1 | Archive |
|---|---|---|---|---|---|
| Auth (login/signup/Google) | ✅ | | | | |
| Projects CRUD | ✅ | | | | |
| Sessions + messages | ✅ | | | | |
| Home chat (Nexus) | ✅ | | | | |
| Workspace chat | ✅ | | | | |
| Decision Ledger | ✅ | | | | |
| GitHub read/write | | ⚠️ | | | |
| Preview (auth fix) | | ⚠️ | | | |
| Blueprints | | | | ⏸️ | |
| Artifacts | | | | ⏸️ | |
| Devserver / Local Dev | ✅ | | | | |
| Image generation | ✅ | | | | |
| Forge | ✅ | | | | |
| Browser agent | | | | ⏸️ | |
| Deploy routes | | | | ⏸️ | |
| MCP | | | | ⏸️ | |
| Conversations/messages (legacy tables) | | | | | 🗄️ |

---

*This audit represents what is in the codebase on June 16, 2026.*
*No fixes were made. No opinions were given. This is the system as it actually exists.*
