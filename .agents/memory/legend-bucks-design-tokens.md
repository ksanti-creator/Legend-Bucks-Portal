---
name: Legend Bucks design tokens & sidebar
description: How the app's theme is driven by CSS tokens, and the trap of flipping a shared token's brightness.
---

# Design tokens & the sidebar-brightness trap

The Legend Bucks web app (`artifacts/legend-bucks`) is themed almost entirely from HSL CSS variables in `src/index.css` (`:root`), mapped via `@theme inline`. Changing tokens + the base `Card` component cascades style across nearly every page — you rarely need per-page edits for a restyle.

**Rule:** before flipping a *shared* token's brightness (e.g. `--sidebar` from dark to light), grep for every surface that hardcodes that token family (`bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-*`).

**Why:** the login page reused the dark `--sidebar` tokens for its right panel. Flipping the sidebar to white turned that panel white-on-white (invisible) until it was re-themed to light. A token that means "dark surface" to one screen and "nav chrome" to another will break one of them when its brightness changes.

**How to apply:** treat any token used for *contrast* (light-on-dark or dark-on-light) as coupled to every consumer's assumption about its brightness. Re-theme all consumers in the same change, or give the odd-one-out its own dedicated tokens.

**Brand boundary:** use the Scaling Up site only as a visual-language reference, never as a source of shop identity or proprietary artwork. Preserve the approved Legend Bucks Shop logos, product images, and copy.

**Why:** The user explicitly requested a visual-only restyle and prohibited importing Scaling Up logos, navigation, metrics, and business rules.

**How to apply:** Original low-priority decorative illustrations are acceptable; reuse existing licensed project fonts. Verify mobile layouts rather than assuming desktop-only support.
