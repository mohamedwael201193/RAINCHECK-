/**
 * BackgroundBeams — adapted from Aceternity UI (MIT License).
 * Source: https://ui.aceternity.com/components/background-beams
 * (component recipe verified against the published source 2026-10-15).
 *
 * RAINCHECK adaptations (never verbatim):
 *  - Dropped the `framer-motion` dependency: beam glow pulses are driven by
 *    SMIL <animate> on gradient coordinates (Chromium/Safari/Firefox
 *    support it), everything else is static SVG.
 *  - Monochrome rain-cyan beams at low opacity (no violet/magenta ramp) —
 *    calm enough to sit behind content.
 *  - 12 beams instead of 50, deterministic seeded timing (no Math.random
 *    in render — stable across re-renders and SSR-safe).
 *  - Reduced-motion: renders the beams statically, no <animate> elements.
 *  - Decorative: aria-hidden, pointer-events none.
 */
import { useId, useMemo, useState, useEffect } from "react";
import "./BackgroundBeams.css";

/** Deterministic pseudo-random in [0,1) — stable across renders. */
function seeded(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Aceternity's beam path rule: same curve, shifted +7/-8 per index. */
function beamPath(i: number): string {
  const p = (x: number, y: number): string => `${x + 7 * i} ${y - 8 * i}`;
  return `M${p(-380, -189)}C${p(-380, -189)} ${p(-312, 216)} ${p(152, 343)}C${p(616, 470)} ${p(684, 875)} ${p(684, 875)}`;
}

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

export function BackgroundBeams({
  className = "",
  beamCount = 12,
  opacity = 0.5,
}: {
  className?: string;
  beamCount?: number;
  opacity?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduce = useReducedMotion();

  const beams = useMemo(
    () =>
      Array.from({ length: beamCount }, (_, i) => ({
        d: beamPath(i),
        // Slow, desynced pulse per beam (18–30s, negative begin = mid-cycle).
        dur: 18 + seeded(i + 1) * 12,
        begin: `-${(seeded(i + 101) * 24).toFixed(1)}s`,
        drift: 88 + seeded(i + 201) * 10,
      })),
    [beamCount],
  );

  return (
    <div
      className={`rcx-beams ${className}`}
      aria-hidden="true"
      style={{ opacity }}
    >
      <svg
        className="rcx-beams-svg"
        width="100%"
        height="100%"
        viewBox="0 0 696 316"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {beams.map((b, i) => (
            <linearGradient
              key={i}
              id={`rcx-beam-${uid}-${i}`}
              gradientUnits="userSpaceOnUse"
              x1="0%"
              y1="0%"
              x2="0%"
              y2="0%"
            >
              {!reduce && (
                <>
                  <animate
                    attributeName="x1"
                    values="0%;100%;0%"
                    dur={`${b.dur}s`}
                    begin={b.begin}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="x2"
                    values="0%;95%;0%"
                    dur={`${b.dur}s`}
                    begin={b.begin}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="y1"
                    values="0%;100%;0%"
                    dur={`${b.dur * 1.3}s`}
                    begin={b.begin}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="y2"
                    values={`0%;${b.drift}%;0%`}
                    dur={`${b.dur * 1.3}s`}
                    begin={b.begin}
                    repeatCount="indefinite"
                  />
                </>
              )}
              {/* Monochrome rain-cyan ramp — calm, on-palette. */}
              <stop stopColor="#35E0FF" stopOpacity="0" />
              <stop stopColor="#35E0FF" stopOpacity="0.55" />
              <stop offset="0.5" stopColor="#7deeff" stopOpacity="0.8" />
              <stop offset="1" stopColor="#35E0FF" stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {beams.map((b, i) => (
          <path
            key={i}
            d={b.d}
            stroke={`url(#rcx-beam-${uid}-${i})`}
            strokeOpacity="0.4"
            strokeWidth="1"
          />
        ))}
      </svg>
    </div>
  );
}
