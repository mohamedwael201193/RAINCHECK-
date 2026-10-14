/**
 * NumberTicker — vendored from Magic UI (MIT License, Copyright (c) Magic UI).
 * Source: https://github.com/magicuidesign/magicui
 *   → apps/www/registry/magicui/number-ticker.tsx
 * Fetched 2026-10-15 via https://magicui.design/r/number-ticker.json.
 *
 * RAINCHECK adaptations (never verbatim behavior):
 *  - Dropped the `motion` dependency (useInView/useMotionValue/useSpring):
 *    count-up now runs on rAF with easeOutExpo + IntersectionObserver,
 *    so the dashboard ships zero animation libraries.
 *  - Reduced-motion: jumps straight to the final value (no animation).
 *  - Accessibility: the animated digits are aria-hidden; a visually-hidden
 *    span carries the exact final value for screen readers.
 *  - The final rendered value is ALWAYS the real number passed in — the
 *    ticker only animates the journey, never the destination.
 */
import { useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import "./NumberTicker.css";

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

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number;
  startValue?: number;
  direction?: "up" | "down";
  delay?: number;
  decimalPlaces?: number;
}

const easeOutExpo = (t: number): number =>
  t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);

const COUNT_DURATION_MS = 1200;

export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  decimalPlaces = 0,
  className = "",
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(startValue);

  const from = direction === "down" ? value : startValue;
  const to = direction === "down" ? startValue : value;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reduced motion: the honest final number, immediately.
    if (reduce) {
      setDisplay(to);
      return;
    }
    let raf = 0;
    let started = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || started) return;
        started = true;
        const t0 = performance.now() + delay * 1000;
        const tick = (now: number) => {
          const t = Math.min(1, Math.max(0, (now - t0) / COUNT_DURATION_MS));
          setDisplay(from + (to - from) * easeOutExpo(t));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        io.disconnect();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [from, to, delay, reduce]);

  const format = (n: number): string =>
    Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(Number(n.toFixed(decimalPlaces)));

  return (
    <span
      className={`rcx-number-ticker ${className}`}
      {...props}
    >
      <span ref={ref} aria-hidden="true">
        {format(display)}
      </span>
      <span className="rcx-sr-only">{format(to)}</span>
    </span>
  );
}
