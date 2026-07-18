"use client";

/**
 * MapCanvas — renders the whole map project (native raster, nearest-neighbor)
 * at the current zoom, overlays an optional tile grid, and translates pointer
 * events into tile coordinates for place/erase. PBR mode runs the software
 * shader over the composited map (preview only; export stays raster).
 */
import { useCallback, useEffect, useRef } from "react";
import { drawRasterScaled, hardenContext } from "@/lib/pixel-studio/canvas";
import { renderMapPreview } from "@/lib/pixel-studio/map/map-compositor";
import { getManifest } from "@/lib/pixel-studio/manifest";
import { DEFAULT_LIGHT, renderPbr } from "@/lib/pixel-studio/pbr/pbr-preview";
import type { MapProject } from "@/lib/pixel-studio/types";

interface Props {
  project: MapProject;
  zoom: number;
  showGrid: boolean;
  viewMode: "pixel" | "pbr";
  onCell: (x: number, y: number) => void;
}

export function MapCanvas({ project, zoom, showGrid, viewMode, onCell }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raster = renderMapPreview(project, true);
    if (viewMode === "pbr") {
      // Treat every opaque pixel as a generic surface for the light preview.
      const material = new Uint8Array(raster.width * raster.height).fill(2); // wool-ish default
      const mats = Object.values(getManifest().materials);
      raster = renderPbr({ color: raster, material }, mats, DEFAULT_LIGHT);
    }
    drawRasterScaled(canvas, raster, Math.max(1, Math.round(zoom / 8)) * 2);

    if (showGrid) {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      hardenContext(ctx);
      const scale = canvas.width / project.width;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= project.width; x++) {
        ctx.beginPath();
        ctx.moveTo(Math.round(x * scale) + 0.5, 0);
        ctx.lineTo(Math.round(x * scale) + 0.5, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= project.height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y * scale) + 0.5);
        ctx.lineTo(canvas.width, Math.round(y * scale) + 0.5);
        ctx.stroke();
      }
    }
  }, [project, zoom, showGrid, viewMode]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const cellFromEvent = (e: React.PointerEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * project.width;
    const py = ((e.clientY - rect.top) / rect.height) * project.height;
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (x < 0 || y < 0 || x >= project.width || y >= project.height) return null;
    return { x, y };
  };

  return (
    <div className="overflow-auto rounded border border-neutral-800 bg-neutral-950 p-2" style={{ maxHeight: "70vh" }}>
      <canvas
        ref={canvasRef}
        className="cursor-crosshair"
        style={{ imageRendering: "pixelated", width: project.width * (zoom / 2), height: project.height * (zoom / 2) }}
        onPointerDown={(e) => {
          draggingRef.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const c = cellFromEvent(e);
          if (c) onCell(c.x, c.y);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          const c = cellFromEvent(e);
          if (c) onCell(c.x, c.y);
        }}
        onPointerUp={() => (draggingRef.current = false)}
        role="application"
        aria-label={`Map grid ${project.width}×${project.height} tiles. Click to place or erase.`}
      />
    </div>
  );
}
