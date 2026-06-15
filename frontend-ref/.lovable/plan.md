## Goal

Make the mobile bottom dock (`UnifiedContextDock`) collapse intelligently so chat surfaces stop feeling cramped — without making navigation feel hidden. Applies to **both** home chat (ambient/active modes) and workspace chat (operational mode).

## Behavior contract

Three independent hide triggers, one shared visible/hidden state:

1. **Scroll-driven slide** — scrolling **down** > 8px hides the dock; any scroll **up** reveals it. Smooth slide (220ms ease).
2. **Input/voice focus** — the instant the chat composer textarea is focused or the mic is recording, the dock vanishes immediately (no animation). On blur, it restores to whatever state the scroll rule says it should be in.
3. **Top-of-page guarantee** — when scroll position is at top (≤8px), dock is always visible regardless of prior state.

**Crescent peek** when hidden:
- The center "A" button keeps its **top ~10px arc** visible above the bottom bezel as a glowing gold crescent.
- Tapping the crescent restores the full dock instantly.
- Side nav slots slide fully off-screen; only the A peeks.

**Default visibility per mode (per user decision):**
- Ambient (home, no convo) → visible, static. Scroll rule still applies once content scrolls.
- Active (home with convo) → visible, scroll-driven.
- Operational (workspace) → **start visible**, scroll-driven (same as active).

## Implementation

### 1. New hook: `src/hooks/useDockVisibility.ts`

Owns the visible/hidden state and exposes:
- `visible: boolean`
- `setInputActive(active: boolean)` — called by composer on focus/blur and mic start/stop.
- `attachScroll(el: HTMLElement | null)` — pass the scroll container; hook installs a passive scroll listener with last-Y tracking.
- `peek()` — force visible (used by crescent tap).

Internal state: `inputActive`, `scrollHidden`, `atTop`. Final `visible = !inputActive && (atTop || !scrollHidden)`.

### 2. `UnifiedContextDock.tsx` changes

- Accept new props: `visible?: boolean` (default true), `onPeekTap?: () => void`.
- Wrap the existing arch + slot row in a `<div>` that translates `translateY(0)` ↔ `translateY(calc(100% - 12px))` based on `visible`. Transition: `transform 220ms cubic-bezier(.32,.72,0,1)`.
- The 12px residual height keeps the crescent of the A visible. The A button itself stays clickable (z-index above the arch), and tapping it calls `onPeekTap` when not visible, otherwise normal `onAtlasCore`.
- Side slots fade `opacity 0` and `pointer-events: none` when hidden so the crescent is the only hit target.

### 3. Wiring at the shell level

`UnifiedShell.tsx` (or wherever `UnifiedContextDock` is rendered today — confirmed at the spot where `ShellFooter intentionally not rendered`) hosts the hook and passes `visible` + `onPeekTap` down.

The shell already knows the current `mode`. It also owns/forwards the chat scroll container ref. Add a lightweight context (`DockVisibilityContext`) so:
- The chat scroll container (in `home.tsx` chat feed + workspace `ChatStream`) calls `attachScroll(ref.current)` once mounted.
- The composer (`ChatComposer` + home composer) calls `setInputActive(true/false)` on textarea focus/blur and voice start/stop.

### 4. Files touched

- **New:** `src/hooks/useDockVisibility.ts`, `src/components/dock-visibility-context.tsx`
- **Edit:** `src/components/UnifiedContextDock.tsx` (visibility prop + transform + crescent hit target)
- **Edit:** `src/components/UnifiedShell.tsx` (provide context, pass `visible`/`onPeekTap` to dock)
- **Edit:** `src/pages/home.tsx` (attach scroll ref of chat feed; wire composer focus/blur)
- **Edit:** `src/components/workspace/ChatStream.tsx` + `src/components/workspace/ChatComposer.tsx` (same wiring for workspace)

### 5. Out of scope

- No change to dock contents, icons, modes, or routing.
- No change to desktop (dock is mobile-only).
- No change to `ShellFooter` (already unmounted).
- No haptics or sound changes.

## Acceptance check

1. Home, no convo, at top → dock fully visible.
2. Home, scrolling chat feed down → dock slides away, gold A crescent visible at bottom.
3. Scroll up one flick → dock slides back in full.
4. Tap composer textarea → dock vanishes immediately, keyboard takes bottom.
5. Dismiss keyboard while mid-scroll → dock stays hidden (scroll rule wins); scroll up → returns.
6. Tap gold crescent while hidden → dock snaps back to full.
7. Same six checks pass inside a workspace chat.
