// components/office/AvatarPaperDoll.tsx
// Thin React wrapper over the framework-agnostic SVG string builder
// (lib/office/avatarPaperDoll.ts). Keeping the geometry in one place means the
// Character Studio preview and the office floor (public/office/map.html, which
// has no React) render the exact same avatar. Pure/deterministic: no hooks, no
// state, no handlers — safe on server and client alike.

import { renderAvatarPaperDollSvg } from "@/lib/office/avatarPaperDoll";
import type { AvatarConfig } from "@/lib/office/avatarConfig";

export interface AvatarPaperDollProps {
  config: AvatarConfig;
  /** Rendered width in px; height follows the 200×260 aspect. */
  size?: number;
  className?: string;
  /** Draw the soft ground shadow under the feet. */
  showShadow?: boolean;
  /** Ring the character with its presence-status color. */
  showStatusRing?: boolean;
  title?: string;
}

export function AvatarPaperDoll({
  config,
  size = 220,
  className,
  showShadow = true,
  showStatusRing = false,
  title,
}: AvatarPaperDollProps) {
  const svg = renderAvatarPaperDollSvg(config, { size, showShadow, showStatusRing, title });
  const height = (size * 260) / 200;
  return (
    <span
      className={className}
      style={{ display: "inline-block", lineHeight: 0, width: size, height }}
      // The markup is built entirely from our own numeric geometry + catalog
      // colors and the config's displayName (escaped in the builder), so there
      // is no untrusted HTML here.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
