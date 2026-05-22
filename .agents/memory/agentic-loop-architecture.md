---
name: Agentic loop architecture
description: How the multi-model tool_use orchestration loop works in POST /api/chat
---

# Agentic Loop Architecture

## The rule
Claude is always the orchestrator. Gemini and GPT-4o are specialist tools called only when the task clearly benefits. Most messages go direct (Claude alone, no loop).

**Why:** Routing every message through a model swarm is expensive and slower. The classifier ensures specialists only wake up when the task demands it.

## How to apply
- `classifyIntent()` — claude-haiku call, returns `isDirect: boolean`. Only runs when a repo is linked OR mode is audit/deep-dive. Defaults to `true` (direct) on failure.
- Direct path: existing `callModel` + text-protocol FILE_READ and TERMINAL_CMD extraction. Unchanged behavior.
- Agentic path: `runAgenticLoop()` using Anthropic `tool_use` API with 4 tools: `read_files`, `deep_read` (Gemini), `write_code` (GPT-4o), `run_command` (terminal sandbox).
- Max 3 iterations. If loop exhausts without `end_turn`, Claude synthesizes from gathered context.
- Full fallback: any exception in the loop → direct Claude call.
- Text-protocol extractors still run after the agentic path as a safety net.

## Fallback decision tree (explicit)
- Tool result fails → Claude sees failure in tool_result content → retries with adjusted approach (up to max iterations)
- Terminal throws → error text returned as tool result → Claude decides next step
- Max iterations hit → synthesis call → explanation of what was tried
- Loop itself throws → logger.warn → direct Claude call
