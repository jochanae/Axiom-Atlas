---
name: Project memory v2 format
description: How the memory column is structured and how tiers work — required before writing any memory.
---

# Project Memory v2 Format

## Structure
```json
{ "v": 2, "entries": [ { "tier": 1, "text": "...", "createdAt": "ISO", "retrievalCount": 0, "lastRetrievedAt": null } ] }
```

## Tier meanings
| Tier | Label | Decay | Weight | Protected | Use for |
|------|-------|-------|--------|-----------|---------|
| 1 | FOUNDATIONAL | Never | 100 | Yes | Locked architectural decisions |
| 2 | IDENTITY | 180d | 50 | No | What the project is, who it's for |
| 3 | EPISODIC | 90d | 30 | Yes | Import events, session milestones |
| 4 | CONTEXTUAL | 30d | 20 | No | Routes, tables, stack detail |
| 5 | TRANSIENT | 7d | 10 | No | Ephemeral context |

## Migration
`parseMemoryStore` in `chat.ts` auto-migrates plain text to Tier 3 entries. So plain text writes are readable, but proper v2 JSON gets correct scoring and decay.

**Why:** The full-import endpoint and any future auto-writes should use v2 JSON with correct tiers. Tier 1 entries (decisions) never decay and score highest, so Atlas always sees them.

**How to apply:** When writing to the `memory` column programmatically, always write `JSON.stringify({ v: 2, entries: [...] })`. Merge with existing entries by parsing first, filtering out stale auto-generated ones, prepending new ones.
