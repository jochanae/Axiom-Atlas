# Atlas — Replit Agent Prompt: Theme Fix + Purple Ambient Glow

## One File Only. Read Before Touching Anything.

The only file to edit is:
`artifacts/atlas/src/index.css`

Do not touch any other file. Do not touch any component. Do not touch any layout.

---

## Fix 1: Theme Consistency

The current theme has some components not respecting the Atlas color tokens correctly. They are rendering with wrong background colors or not switching properly.

In `artifacts/atlas/src/index.css`, verify and correct these token values in the `:root` block:

**Background** — should be a deep warm dark, not pure black and not grey:
```css
--atlas-bg: #0D0B09;
```

**Surface** — cards, panels, drawers — slightly lighter than bg:
```css
--atlas-surface: #171410;
```

**Border** — subtle warm dividers:
```css
--atlas-border: rgba(212, 175, 55, 0.15);
```

**Gold** — the primary accent, consistent across all components:
```css
--atlas-gold: #D4AF37;
```

**Ember** — the warm orange/brown secondary accent:
```css
--atlas-ember: #C4521A;
```

**Muted text** — secondary content:
```css
--atlas-muted: rgba(255, 255, 255, 0.4);
```

**Foreground** — primary text:
```css
--atlas-fg: rgba(255, 255, 255, 0.87);
```

Also ensure the Tailwind semantic tokens in the `@theme inline` block map to these correctly:
```css
--color-background: var(--atlas-bg);
--color-foreground: var(--atlas-fg);
--color-border: var(--atlas-border);
```

---

## Fix 2: Purple Ambient Glow in Dark Mode

Add a deep purple radial ambient glow to the main background. This glow should feel cinematic and subtle — not bright, not neon. It is the same treatment used in Axiom's System Map background.

Add this to the `body` styles in `artifacts/atlas/src/index.css`:

```css
body {
  background-color: var(--atlas-bg);
  background-image: 
    radial-gradient(
      ellipse 80% 60% at 50% 0%,
      rgba(88, 28, 135, 0.18) 0%,
      transparent 70%
    ),
    radial-gradient(
      ellipse 60% 40% at 80% 100%,
      rgba(88, 28, 135, 0.10) 0%,
      transparent 60%
    );
  background-attachment: fixed;
  min-height: 100vh;
}
```

**What this does:**
- Primary glow: soft purple bloom from the top center — visible but not aggressive
- Secondary glow: lighter purple hint from bottom right — adds depth
- `background-attachment: fixed` keeps the glow stationary as content scrolls — cinematic feel
- Both glows fade to transparent so the edges blend naturally into the dark background

**The purple color used:** `rgba(88, 28, 135, 0.18)` — this is a deep violet, not bright purple. At 18% opacity it reads as atmospheric, not loud.

---

## What Success Looks Like

After this change:
- All components render with consistent warm dark backgrounds
- Gold accents are the same `#D4AF37` everywhere
- The main background has a subtle purple atmospheric glow visible especially at the top of the screen
- The cream/light mode (if it exists) is completely unaffected
- No component backgrounds change color — only the body background glow is new

---

## Scope

**`artifacts/atlas/src/index.css` only.**
Do not touch any component files.
Do not touch any layout files.
Do not touch any route files.
Do not change any functionality.
If anything breaks, revert and report.
