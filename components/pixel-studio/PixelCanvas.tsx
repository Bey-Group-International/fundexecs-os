"use client";

/**
 * PixelCanvas — renders a character frame to a hardened (smoothing-off) canvas.
 * In "pixel" mode it blits the native composite scaled by nearest-neighbor; in
 * "pbr" mode it runs the software PBR shader over the material frame. When
 * `animate` is set it drives an AnimationPlayer from requestAnimationFrame and
 * honors prefers-reduced-motion.
 */
import { useEffect, useMemo, useRef } from "react";
import { AnimationPlayer } from "@/lib/pixel-studio/animation-player";
import { getComposer } from "@/lib/pixel-studio/browser-runtime";
import { drawRasterScaled } from "@/lib/pixel-studio/canvas";
import { getManifest } from "@/lib/pixel-studio/manifest";
import { DEFAULT_LIGHT, renderPbr } from "@/lib/pixel-studio/pbr/pbr-preview";
import type { AnimationState, CharacterConfig, Direction } from "@/lib/pixel-studio/types";

interface Props {
  config: CharacterConfig;
  direction: Direction;
  state: AnimationState;
  scale: number;
  viewMode: "pixel" | "pbr";
  animate?: boolean;
  playing?: boolean;
  speed?: number;
  /** Fixed frame index for static thumbnails (ignored when animate). */
  frame?: number;
  lightIntensity?: number;
  lightAngle?: number;
  onFrame?: (frame: number, total: number) => void;
  className?: string;
  ariaLabel?: string;
}

export function PixelCanvas({
  config,
  direction,
  state,
  scale,
  viewMode,
  animate = false,
  playing = true,
  speed = 1,
  frame = 0,
  lightIntensity = 1.1,
  lightAngle = 135,
  onFrame,
  className,
  ariaLabel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const manifest = getManifest();
  const composer = getComposer();

  const light = useMemo(() => {
    const rad = (lightAngle * Math.PI) / 180;
    return {
      ...DEFAULT_LIGHT,
      keyDir: { x: Math.cos(rad), y: -Math.sin(rad), z: 0.8 },
      keyIntensity: lightIntensity,
    };
  }, [lightAngle, lightIntensity]);

  const materials = useMemo(() => Object.values(manifest.materials), [manifest]);

  // Draw a single frame in the current mode.
  const draw = useMemo(
    () => (f: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (viewMode === "pbr") {
        const mf = composer.composeFrameWithMaterials(config, state, direction, f);
        const shaded = renderPbr(mf, materials, light);
        drawRasterScaled(canvas, shaded, scale);
      } else {
        const raster = composer.composeFrame(config, state, direction, f);
        drawRasterScaled(canvas, raster, scale);
      }
    },
    [composer, config, state, direction, viewMode, materials, light, scale],
  );

  // Static render path.
  useEffect(() => {
    if (animate) return;
    draw(frame);
  }, [animate, draw, frame]);

  // Animated render path.
  useEffect(() => {
    if (!animate) return;
    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const player = new AnimationPlayer(state, manifest.animations[state]);
    player.speed = speed;
    let raf = 0;
    let mounted = true;

    const loop = (now: number) => {
      if (!mounted) return;
      if (playing && !reduced) {
        const changed = player.tick(now);
        if (changed || now === 0) {
          draw(player.frame);
          onFrame?.(player.frame, player.frameCount);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    draw(player.frame);
    onFrame?.(player.frame, player.frameCount);
    raf = requestAnimationFrame(loop);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, [animate, state, speed, playing, manifest, draw, onFrame]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ imageRendering: "pixelated" }}
      role="img"
      aria-label={ariaLabel ?? `${config.displayName} ${state} facing ${direction}`}
    />
  );
}
