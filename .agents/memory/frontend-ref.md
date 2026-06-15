---
name: Frontend reference clone
description: frontend-ref/ is a live clone of jochanae/atlas-idk; pull it at session start before writing any Cursor prompts
---

## Rule
Before writing any Cursor prompt or making any claim about the frontend code, run:

```bash
git -C frontend-ref pull
```

Then read the actual file in `frontend-ref/src/` before drawing conclusions.

## Why
The reference copy at `artifacts/atlas/` is months stale and caused a false diagnosis (told user `/auth/callback` was missing when it existed and was wired). Cloning the real repo (`jochanae/atlas-idk`) into `frontend-ref/` fixed this.

## How to apply
- Session start → `git -C frontend-ref pull` (or clone fresh if directory missing: `git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/jochanae/atlas-idk.git" frontend-ref --depth=1`)
- Any Cursor prompt → read the real file in `frontend-ref/src/` first
- Never read `artifacts/atlas/` for frontend truth — it is dead
- `frontend-ref/` is gitignored, not committed to this repo
