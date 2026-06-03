---
name: Dual-engine image generation
description: How IMAGE_GEN tokens route to Gemini Imagen 3 vs DALL·E 3 in chat.ts and imagine.ts
---

## The rule

Atlas emits `IMAGE_GEN:{"prompt":"...","mode":"render"|"schematic","size":"..."}` tokens in its responses.
- **render** → Gemini Imagen 3 (premium, cinematic, client-facing UI/UX)
- **schematic** → DALL·E 3 (technical diagrams, architecture flows, relational maps)
- Each engine has an automatic fallback to the other if its key is missing or the call fails.
- Atlas may emit up to 2 IMAGE_GEN tokens per response (one render + one schematic).

## Why

Gemini Imagen 3 excels at atmospheric, luxury-aesthetic visuals with realistic lighting and materials.
DALL·E 3 excels at literal prompt-following for dense multi-layered scenes with precise geometry.
Routing silently by intent gives consistently better output than picking one engine for everything.

## How to apply

- `imagine.ts` — standalone `/api/imagine` endpoint; accepts `mode` field; same routing logic
- `chat.ts` — IMAGE_GEN tokens extracted from rawContent before content parsers run (stripped from displayed text); generation fires after autoName resolution; results returned as `imageGen: { images: [...] }` in finalPayload
- Frontend reads `data.imageGen.images[]` and renders each as an `<img>` tag inline in the chat bubble
- `OPENAI_API_KEY` must be present in Cloud Run environment for schematic mode to work (Jochanae adds manually)
- `GOOGLE_GEMINI_API_KEY` already present covers render mode
