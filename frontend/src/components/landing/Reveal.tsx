import { useEffect, useRef } from "react";
import "./Reveal.css";

type RevealProps = {
  children: React.ReactNode;
  className?: string;
  /** stagger delay in ms */
  delay?: number;
  id?: string;
};

/**
 * Reveal — scroll-triggered entrance: opacity + translateY only, ≤0.8s,
 * reduced-motion safe. Observes once, then disconnects.
 */
export default function Reveal({
  children,
  className = "",
  delay = 0,
  id,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("rc-reveal-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("rc-reveal-in");
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      className={`rc-reveal ${className}`.trim()}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
