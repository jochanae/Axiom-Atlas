# Prompt Audit — NEXUS vs DEV

Notes:
- Read-only source audit: `chat.ts` was not changed.
- `DEV_SYSTEM_PROMPT` is defined in `artifacts/api-server/src/routes/chat.ts`.
- `NEXUS_SYSTEM_PROMPT` is currently defined in `artifacts/api-server/src/routes/nexus.ts`, not `chat.ts`.
- Character counts are approximate JS string lengths. Runtime payloads (`memoryText`, file trees, ledger rows, project names, URL captures, etc.) are variable; appended-block counts below count the static wrapper/instruction text unless noted.

## NEXUS_SYSTEM_PROMPT
- Approximate total length (chars): ~3,112
- Section-by-section breakdown:
  - Identity / surface role — ~122 chars
  - Voice / non-assistant posture — ~319 chars
  - Founder / portfolio-thinking context — ~324 chars
  - Home-view scope — ~142 chars
  - Conversation style / tone calibration — ~470 chars
  - Capability boundary: no code or GitHub from home — ~252 chars
  - Navigation protocol header and token format — ~171 chars
  - Navigation trigger rule — ~236 chars
  - Ledger / scan / flow-map action protocol — ~653 chars
  - Memory tag protocol and tier examples — ~295 chars
  - Memory save limit — ~80 chars
  - Closing identity reinforcement — ~26 chars

## DEV_SYSTEM_PROMPT
- Approximate total length (chars): ~13,113
- Section-by-section breakdown:
  - [IDENTITY] Workspace Atlas identity — ~87 chars
  - [IDENTITY] Non-tool / thinking-partner voice — ~270 chars
  - [IDENTITY] Non-technical founder context and job — ~250 chars
  - [IDENTITY] Response style rules and register matching — ~877 chars
  - [PROTOCOL] Clarification block JSON protocol — ~630 chars
  - [PROTOCOL] IMAGE_GEN vs ARTIFACT routing rule — ~631 chars
  - [CAPABILITY] ARTIFACT protocol intro — ~264 chars
  - [CAPABILITY] ARTIFACT token example — ~83 chars
  - [CAPABILITY] ARTIFACT content/type rules — ~445 chars
  - [IDENTITY] Conversational spine intro — ~162 chars
  - [IDENTITY] Conversational spine core principles — ~383 chars
  - [IDENTITY] Disagreement examples — ~140 chars
  - [IDENTITY] Perspective firmness — ~77 chars
  - [IDENTITY] Register awareness — ~313 chars
  - [IDENTITY] Proactive pattern recognition — ~251 chars
  - [IDENTITY] Depth calibration — ~178 chars
  - [PROTOCOL] Epistemic spine / truthfulness rules — ~1,132 chars
  - [CONTEXT] Tech stack heading — ~25 chars
  - [CONTEXT] Actual tech stack table — ~304 chars
  - [CAPABILITY] FILE_EDIT heading — ~21 chars
  - [CAPABILITY] FILE_EDIT purpose — ~120 chars
  - [CAPABILITY] FILE_EDIT token format — ~167 chars
  - [CAPABILITY] FILE_EDIT critical rules — ~365 chars
  - [CAPABILITY] Never-edit path rules — ~105 chars
  - [CAPABILITY] LINE_PATCH purpose — ~110 chars
  - [CAPABILITY] LINE_PATCH token format — ~152 chars
  - [CAPABILITY] LINE_PATCH exact-match rule — ~77 chars
  - [CAPABILITY] FILE_READ request protocol — ~184 chars
  - [CAPABILITY] Image generation heading — ~42 chars
  - [CAPABILITY] Image generation capability assertion — ~224 chars
  - [CAPABILITY] Image generation critical rules — ~302 chars
  - [CAPABILITY] IMAGE_GEN token example — ~97 chars
  - [CAPABILITY] IMAGE_GEN mode/size/detail rules — ~554 chars
  - [CAPABILITY] Image-capability correction rule — ~86 chars
  - [CAPABILITY] Memory override for stale image-generation facts — ~359 chars
  - [CAPABILITY] Proactive visual generation heading — ~30 chars
  - [CAPABILITY] Proactive visual intuition — ~182 chars
  - [CAPABILITY] Proactive IMAGE_GEN triggers — ~489 chars
  - [CAPABILITY] Proactive IMAGE_GEN anti-triggers — ~193 chars
  - [CAPABILITY] Proactive visual response style — ~174 chars
  - [CAPABILITY] Browser agent heading — ~40 chars
  - [CAPABILITY] Browser agent capability overview — ~186 chars
  - [CAPABILITY] BROWSER_VISIT emission instruction — ~84 chars
  - [CAPABILITY] BROWSER_VISIT token examples — ~244 chars
  - [CAPABILITY] Browser modes — ~938 chars
  - [CAPABILITY] Browser usage rules — ~968 chars
  - [IDENTITY] Closing identity reinforcement — ~26 chars

## Appended blocks

### DEV / workspace chat assembly

Order reflects `systemPrompt += ...` in `artifacts/api-server/src/routes/chat.ts`.

| Order | Block | Tag | Approx length |
|---:|---|---|---:|
| 1 | `ATLAS_PLATFORM_KNOWLEDGE` shared platform block | CAPABILITY | ~13,934 |
| 2 | `--- ACTIVE PROJECT ---` project name/description wrapper | CONTEXT | ~200 + project text |
| 3 | `--- YOUR PORTFOLIO ---` other-project list | CONTEXT | ~60 + project names |
| 4 | `--- WHO YOU'RE WORKING WITH ---` user profile | CONTEXT | ~35 + profile |
| 5 | `--- ABOUT THIS FOUNDER ---` durable user memory | CONTEXT | ~146 + memory |
| 6 | `--- PROJECT MEMORY ---` project memory | CONTEXT | ~96 + memory |
| 7 | `--- COMMITTED DECISIONS ---` decision ledger | CONTEXT | ~143 + ledger rows |
| 8 | `--- PROJECT MAP ---` auto-scanned project map | CONTEXT | ~151 + map |
| 9 | `--- LINKED REPO STRUCTURE ---` repo tree | CONTEXT | ~134 + tree |
| 10 | Recent repo activity context plus narrative instruction | CONTEXT | ~330 + activity |
| 11 | `--- SESSION CONTINUITY ---` first-message behavior | PROTOCOL | ~699 |
| 12 | `--- RECENT PRODUCTION ERRORS ---` production error context | CONTEXT | ~75 + errors |
| 13 | `--- CURRENT CODEBASE MAP ---` self-map context | CONTEXT | ~73 + map |
| 14 | `--- FORGE STRATEGIC MAP ---` forge context | CONTEXT | ~120 + context |
| 15 | `--- CODE CONTEXT ---` read file contents for FILE_EDIT | CONTEXT | ~140 + file content |
| 16 | `modeInstructions[activeMode]`: BUILD / PLAN / THINK | PROTOCOL | BUILD ~1,065; PLAN ~385; THINK ~339 |
| 17 | `--- ACTIVE MODE: FLOW ARCHITECT ---` flow canvas node protocol | PROTOCOL | ~1,050 + node list |
| 18 | `workspaceLensInstructions[workspaceLens]`: FLOW / BUILD / LOOK / SCENARIO | PROTOCOL | FLOW ~534; BUILD ~695; LOOK ~566; SCENARIO ~567 |
| 19 | `--- IMAGE_GEN AVAILABILITY OVERRIDE ---` | CAPABILITY | ~473 |
| 20 | Legacy project style lens: STRATEGIST / REVIEWER / TEACHER | PROTOCOL | STRATEGIST ~197; REVIEWER ~165; TEACHER ~141 |
| 21 | `--- VISUAL VAULT ---` image vault note | CONTEXT | ~55 + vault note |
| 22 | `--- LIVE URL CAPTURE ---` URL screenshot note | CONTEXT | ~65 + URL note |
| 23 | `--- SECRETS VAULT ---` key-name-only secrets context | CONTEXT | ~244 + key names |
| 24 | `--- RECENT RUNTIME ERRORS ---` runtime error context | CONTEXT | ~202 + errors |

### NEXUS / Global Insight assembly

Order reflects `systemPrompt` construction and `systemPrompt += ...` in `artifacts/api-server/src/routes/nexus.ts`.

| Order | Block | Tag | Approx length |
|---:|---|---|---:|
| 1 | Base `NEXUS_SYSTEM_PROMPT` | IDENTITY | ~3,112 |
| 2a | Idea-mode branch: `IDEA_MODE_POSTURE` | PROTOCOL | ~2,115 |
| 2b | Non-idea branch: `CONVERSATIONAL_EXPANSION_PROTOCOL` | PROTOCOL | ~1,041 |
| 3 | `--- SESSION CONTEXT ---` reflection/idea mode flags | PROTOCOL | ~80 |
| 4 | `ATLAS_PLATFORM_KNOWLEDGE` shared platform block | CAPABILITY | ~13,934 |
| 5 | `--- WHO YOU'RE WORKING WITH ---` user profile | CONTEXT | ~35 + profile |
| 6 | `--- HOME ONBOARDING CONTEXT ---` user-type guidance | PROTOCOL | ~175 |
| 7 | `--- YOUR PROJECTS ---` actual projects list | CONTEXT | ~145 + projects |
| 8 | `--- YOUR PROJECT PORTFOLIO (...) ---` full roster | CONTEXT | ~55 + roster |
| 9 | `--- PORTFOLIO HEALTH ---` portfolio metrics | CONTEXT | ~155 + metrics |
| 10 | `--- LIVE APP HEALTH ---` monitor results | CONTEXT | ~220 + monitor context |
| 11 | `--- COMMITTED DECISIONS ACROSS PORTFOLIO ---` | CONTEXT | ~130 + ledger |
| 12 | `--- AGGREGATED PROJECT MEMORY ---` | CONTEXT | ~100 + memory |
| 13 | Focused project file tree | CONTEXT | ~65 + paths |
| 14 | `--- FOCUSED PROJECT: ... ---` focus instruction | CONTEXT | ~330 + project name |
| 15 | Focused committed decisions | CONTEXT | ~22 + decisions |
| 16 | Focused project memory | CONTEXT | ~16 + memory |
| 17 | Focused recent commits instruction | CONTEXT | ~120 + commits |
| 18 | Full ledger state block | CONTEXT | ~330 + titles |
| 19 | Parking lot awareness | CONTEXT | ~210 + parked items |
| 20 | Cross-project tensions / flow-map state | CONTEXT | ~600 + tensions/nodes |
| 21 | `--- END FOCUSED PROJECT ---` | CONTEXT | ~28 |
| 22 | `--- AUDIT MODE ACTIVE ---` or `--- DEEP DIVE MODE ACTIVE ---` | PROTOCOL | AUDIT ~310; DEEP DIVE ~340 |
| 23 | `--- BROWSER AGENT ---` | CAPABILITY | ~1,092 |
| 24 | `--- VISUAL VAULT ---` | CONTEXT | ~55 + vault note |
| 25 | `--- LIVE URL CAPTURE ---` | CONTEXT | ~65 + URL note |
| 26 | `--- RECENT RUNTIME ERRORS ---` | CONTEXT | ~202 + errors |

## Summary table

DEV totals below are the static default assembled workspace prompt floor: `DEV_SYSTEM_PROMPT` + `ATLAS_PLATFORM_KNOWLEDGE` + session continuity + default THINK mode + default FLOW workspace lens + IMAGE_GEN override. Optional runtime context blocks add variable CONTEXT length.

| Prompt/category | Approx chars |
|---|---:|
| DEV IDENTITY | ~3,014 |
| DEV PROTOCOL | ~3,965 |
| DEV CAPABILITY | ~21,692 |
| DEV CONTEXT | ~329 + runtime context |
| DEV static assembled floor | ~29,100 |
| NEXUS IDENTITY total (`NEXUS_SYSTEM_PROMPT`) | ~3,112 |
