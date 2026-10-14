/**
 * AmbientAurora — a CSS-only aurora backdrop in the ReactBits Aurora visual
 * language (soft cyan glow bands drifting at the top of the viewport).
 *
 * Why CSS, not the vendored WebGL Aurora: the real ReactBits Aurora source
 * was fetched, ported, and evaluated, but its WebGL canvas composites as an
 * opaque white wash under headless Chromium (both SwiftShader and default
 * GL) — unverifiable in our screenshot pipeline, so it was dropped per the
 * vendor policy (see vendor/VENDOR.md). This adaptation keeps the look —
 * slow-drifting cyan/teal glow — with zero WebGL, zero new dependencies.
 *
 * Performance: three layers, transform + opacity keyframes only, no
 * blur() filters (soft edges come from radial-gradient falloff).
 * Reduced-motion: static glow, no animation.
 * Decorative: aria-hidden, pointer-events none.
 */
import "./AmbientAurora.css";

export default function AmbientAurora({ opacity = 0.5 }: { opacity?: number }) {
  return (
    <div className="rcs-amb" aria-hidden="true" style={{ opacity }}>
      <div className="rcs-amb-blob rcs-amb-a" />
      <div className="rcs-amb-blob rcs-amb-b" />
      <div className="rcs-amb-blob rcs-amb-c" />
    </div>
  );
}
