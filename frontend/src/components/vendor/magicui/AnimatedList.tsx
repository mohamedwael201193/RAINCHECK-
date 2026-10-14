/**
 * AnimatedList — vendored from Magic UI (MIT License, Copyright (c) Magic UI).
 * Source: https://github.com/magicuidesign/magicui
 *   → apps/www/registry/magicui/animated-list.tsx
 * Fetched 2026-10-15 via https://magicui.design/r/animated-list.json.
 *
 * RAINCHECK adaptations (never verbatim behavior):
 *  - Dropped the `motion` dependency (AnimatePresence/motion spring):
 *    staggered entrance via CSS keyframes (opacity + translateY only).
 *  - The original reveals items progressively on a timer (notification
 *    carousel); this adaptation renders every real item immediately in
 *    DOM order (screen-reader honest) and only staggers the *entrance*.
 *  - `as` prop renders a semantic container (ol/ul/div); the entrance
 *    class + delay are merged onto each child via cloneElement so list
 *    semantics stay valid (no wrapper divs between list and items).
 *  - Reduced-motion: no animation, items simply appear.
 *  - Stagger capped so long feeds don't keep animating forever.
 */
import { Children, cloneElement, isValidElement, memo } from "react";
import type {
  ComponentPropsWithoutRef,
  ElementType,
  ReactElement,
  ReactNode,
} from "react";
import "./AnimatedList.css";

export interface AnimatedListProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
  /** Container element: "div" | "ol" | "ul". Default "div". */
  as?: "div" | "ol" | "ul";
  /** ms between item entrances. Default 70. */
  stagger?: number;
  /** cap the stagger cascade (items past this share the max delay). */
  maxStagger?: number;
}

type ChildProps = {
  className?: string;
  style?: React.CSSProperties;
};

export const AnimatedList = memo(function AnimatedList({
  children,
  className = "",
  as = "div",
  stagger = 70,
  maxStagger = 14,
  ...props
}: AnimatedListProps) {
  const Tag = as as ElementType;
  const items = Children.toArray(children);
  return (
    <Tag className={`rcx-animated-list ${className}`} {...props}>
      {items.map((child, i) => {
        if (!isValidElement<ChildProps>(child)) return child;
        const el = child as ReactElement<ChildProps>;
        return cloneElement(el, {
          className: `rcx-animated-item ${(el.props.className ?? "").trim()}`,
          style: {
            ...el.props.style,
            animationDelay: `${Math.min(i, maxStagger) * stagger}ms`,
          },
        });
      })}
    </Tag>
  );
});

AnimatedList.displayName = "AnimatedList";
