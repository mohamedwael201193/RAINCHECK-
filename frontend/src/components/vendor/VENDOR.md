# Vendored UI — sources, licenses, adaptations

Every third-party visual in the RAINCHECK dashboard is fetched as real
source, vendored locally under `src/components/vendor/`, and adapted to
the RAINCHECK palette (#0B1220 / #35E0FF / #F4EFE6). Nothing is hotlinked.
Nothing is verbatim: adaptations are noted per component. All animation
is transform/opacity (or GPU shader) only and reduced-motion safe.

## Vendored

### 1. NumberTicker — Magic UI
- **Source:** https://github.com/magicuidesign/magicui → `apps/www/registry/magicui/number-ticker.tsx`
- **License:** MIT (Copyright (c) Magic UI)
- **Files:** `vendor/magicui/NumberTicker.tsx`, `vendor/magicui/NumberTicker.css`
- **Adaptations:** dropped the `motion` dependency — count-up runs on
  rAF (easeOutExpo) + IntersectionObserver, so the dashboard ships no
  animation library; reduced-motion jumps to the final value; animated
  digits are `aria-hidden` with a visually-hidden exact value for
  screen readers. The destination number is always the real figure.
- **Used in:** `StatsStrip` (Open receipts, Escrowed USDC/EURC, Disputes).

### 2. AnimatedList — Magic UI
- **Source:** https://github.com/magicuidesign/magicui → `apps/www/registry/magicui/animated-list.tsx`
- **License:** MIT (Copyright (c) Magic UI)
- **Files:** `vendor/magicui/AnimatedList.tsx`, `vendor/magicui/AnimatedList.css`
- **Adaptations:** dropped `motion` — staggered entrance via CSS keyframes
  (opacity + translateY only, capped cascade); every real item renders
  immediately in DOM order (the original's timed progressive reveal is a
  notification-carousel pattern, dishonest for a data feed);
  reduced-motion shows items statically.
- **Used in:** `ActivityPage` event feed.

### 3. BackgroundBeams — Aceternity UI
- **Source:** https://ui.aceternity.com/components/background-beams
- **License:** MIT
- **Files:** `vendor/aceternity/BackgroundBeams.tsx`, `vendor/aceternity/BackgroundBeams.css`
- **Adaptations:** dropped `framer-motion` — beam glow pulses use SMIL
  `<animate>` on gradient coordinates; monochrome rain-cyan ramp at low
  opacity (no violet/magenta); 12 beams instead of 50; deterministic
  seeded timing (no `Math.random` in render); reduced-motion renders
  static beams; decorative `aria-hidden`.
- **Used in:** `TapeEmpty` backdrop (behind the dashed illustration).

### 4. Shield 3D icon — 3dicons
- **Source:** https://3dicons.co/ (icon: shield)
- **License:** CC0 1.0 Universal — free for personal and commercial use,
  no attribution required (verified on 3dicons.co/about, 2026-10-15).
- **Files:** `frontend/public/assets/3d/shield-3d.webp` (200×200, self-hosted)
- **Used in:** Verify page hero.
- Downloaded but **dropped**: `clock-3d`, `target-3d` — their orange/red
  renders clash with the RAINCHECK palette; removed from the repo.

### 5. Token icons — self-hosted (pre-existing)
- `frontend/public/assets/tokens/usdc.png`, `eurc.png` — official
  Circle-brand marks, verified on disk. Featured richly: StatsStrip
  cells, receipt tickets, and the New Receipt token selector cards.

## 6. Fonts — self-hosted (OFL, via Google Fonts)
- **Source:** https://fonts.googleapis.com (css2 API) → woff2 binaries
  from https://fonts.gstatic.com — **License:** SIL Open Font License 1.1
  (Archivo Black, Inter)
- **Files:** `frontend/public/assets/fonts/` — 10 woff2 (Archivo Black
  400; Inter 400/500/600/700; latin + latin-ext subsets) + `fonts.css`
  with local `@font-face` rules; `index.html` links the local CSS only.
- **Why:** the sandbox proxy blocks fonts.googleapis.com at runtime, so
  the CDN `<link>` produced console resource errors and fell back to
  system fonts. Self-hosting removes the external dependency entirely —
  nothing font-related leaves the machine.
- **Adaptations:** latin + latin-ext subsets only (full unicode-range
  sets dropped — the product is English-only); `font-display: swap` kept.

## Ambient aurora (original, not vendored)

`src/components/dashboard/AmbientAurora.tsx` is original RAINCHECK code in
the ReactBits Aurora *visual language* (soft cyan glow bands drifting at
the top of the viewport): three radial-gradient layers, transform +
opacity keyframes only, no `blur()` filters, reduced-motion safe. It
exists because the real WebGL Aurora (below) could not be verified.

## Evaluated and dropped (with reasons)

- **ReactBits Aurora (WebGL)** — the actual source was fetched from
  https://github.com/DavidHDev/react-bits (`src/content/Backgrounds/Aurora/`,
  MIT) and ported JSX→TSX with RAINCHECK palette defaults. DROPPED after
  evaluation: its WebGL canvas composites as an opaque white wash under
  headless Chromium (both SwiftShader and default GL paths) despite a
  transparent framebuffer — unverifiable in our screenshot pipeline, so it
  fails the ship bar. Replaced by the CSS `AmbientAurora` above, which
  renders identically everywhere. Files removed from the repo.
- **cursify.ui-layouts.com** — cursor-animation library only (fairydust /
  trailing cursors). Custom cursors harm usability on a functional
  escrow dashboard; nothing usable for dashboard chrome.
- **pixel-perfect.space** — component sources are not openly fetchable
  (interactive docs, no public repo found for the library). Its "Square
  Border" dashed-border idiom is already implemented natively in
  `TapeEmpty`'s dashed-SVG illustration.
- **shadcn/ui Sidebar** — requires the radix + CSS-variable theming
  system and clashes with the relay "TAPE" reference's bespoke sidebar;
  the AppShell implements the same information architecture natively.
  (Magic UI, shadcn's official companion registry, IS vendored above.)
- **Motion Primitives / MicroKit UI** — catalogs are physics/cursor
  micro-interactions; nothing beats the relay reference for escrow
  dashboard chrome, and spring-physics gimmicks would fight the
  ticket/tape motif.
