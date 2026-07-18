"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ExecutiveCharacter } from "./characterConfig";
import { spriteFrameMaps, type SpriteAnimationState } from "./spriteFrameMap";

type ExecutiveSpriteProps = {
  character: ExecutiveCharacter;
  state?: SpriteAnimationState;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
  onSelect?: () => void;
};

const SIZE_CLASS = {
  sm: "h-12 w-12",
  md: "h-16 w-16",
  lg: "h-24 w-24",
};

const SIZE_PIXELS = {
  sm: 48,
  md: 64,
  lg: 96,
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function ExecutiveSprite({
  character,
  state = character.defaultState,
  size = "md",
  interactive = false,
  onSelect,
}: ExecutiveSpriteProps) {
  const reducedMotion = useReducedMotion();
  const frameMap = spriteFrameMaps[character.frameMapKind];
  const animation = frameMap.animations[state] ?? frameMap.animations.idle;
  const [frameIndex, setFrameIndex] = useState(0);
  const hasSprite = Boolean(character.spriteSheet);

  useEffect(() => {
    if (reducedMotion || !hasSprite || animation.frames.length <= 1) {
      setFrameIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % animation.frames.length);
    }, 1000 / animation.fps);
    return () => window.clearInterval(interval);
  }, [animation.fps, animation.frames.length, hasSprite, reducedMotion]);

  const frame = animation.frames[frameIndex] ?? animation.frames[0] ?? 0;
  const displaySize = SIZE_PIXELS[size];
  const spriteScale = displaySize / frameMap.frameHeight;
  const spriteStyle = useMemo<CSSProperties>(
    () => ({
      backgroundImage: character.spriteSheet ? `url(${character.spriteSheet})` : undefined,
      backgroundPosition: `-${frame * frameMap.frameWidth}px -${animation.row * frameMap.frameHeight}px`,
      backgroundSize: "auto",
      imageRendering: "pixelated",
      width: frameMap.frameWidth,
      height: frameMap.frameHeight,
      transform: `scale(${spriteScale})`,
      transformOrigin: "center bottom",
    }),
    [
      animation.row,
      character.spriteSheet,
      frame,
      frameMap.frameHeight,
      frameMap.frameWidth,
      spriteScale,
    ],
  );

  const body = hasSprite ? (
    <span
      aria-hidden
      className={`${SIZE_CLASS[size]} relative grid shrink-0 place-items-end justify-items-center overflow-visible`}
    >
      <span className="block bg-no-repeat" style={spriteStyle} />
    </span>
  ) : (
    <span
      aria-hidden
      className={`${SIZE_CLASS[size]} relative grid shrink-0 place-items-center overflow-hidden rounded-[0.7rem] border border-gold-500/45 bg-[#08101f] font-mono text-xs font-bold text-gold-300 shadow-[inset_0_0_0_2px_rgba(251,191,36,0.12),0_0_22px_rgba(251,191,36,0.2)]`}
      style={{ imageRendering: "pixelated" }}
    >
      <span
        className="absolute inset-1 rounded-md border border-gold-500/25"
        style={{ background: `radial-gradient(circle at 50% 30%, ${character.themeColor}33, transparent 58%)` }}
      />
      <span className="relative">{character.fallbackInitials}</span>
      <span className="absolute bottom-1 h-1 w-8 rounded-full bg-black/50" />
    </span>
  );

  if (!interactive) {
    return (
      <span className="inline-flex items-center justify-center" aria-label={`${character.name} sprite`}>
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className="inline-flex rounded-xl outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 motion-reduce:hover:translate-y-0"
      aria-label={`Open ${character.name} guidance`}
    >
      {body}
    </button>
  );
}
