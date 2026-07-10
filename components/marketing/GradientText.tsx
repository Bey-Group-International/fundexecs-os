import { createElement, type ElementType, type ReactNode } from "react";

type GradientTextProps = {
  children: ReactNode;
  /** Element to render. Defaults to <span>; pass "h1"/"h2" for headings. */
  as?: ElementType;
  className?: string;
  /** Pan the gradient. Off renders a static gold→neural fill. */
  animate?: boolean;
};

// Clips a panning gold→neural gradient to its text. The colors live in
// globals.css (.fx-text-gradient) so they track theme-day/theme-night with the
// rest of the fx tokens; this component only wires up the element + motion.
// The global prefers-reduced-motion catch-all freezes the pan for users who
// ask, leaving a legible static gradient.
export function GradientText({
  children,
  as: Tag = "span",
  className = "",
  animate = true,
}: GradientTextProps) {
  // createElement (not JSX) so the dynamic `as` tag isn't resolved against the
  // global JSX.IntrinsicElements catalog — which @react-three/fiber augments
  // with three.js elements whose children type is `never`.
  return createElement(
    Tag,
    { className: `fx-text-gradient ${animate ? "animate-gradient-pan" : ""} ${className}`.trim() },
    children,
  );
}
