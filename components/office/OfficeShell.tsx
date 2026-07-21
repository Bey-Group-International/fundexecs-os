"use client";

// The Virtual Office — a map-first spatial view of the firm's building.
//
// This is the reboot's map surface: a native Canvas 2D floor plan of the
// organisation's building, with multiple floors, an institutional environment
// (materials, lighting, signage, furniture), interaction-zone overlays, and a
// drag-to-edit MapMaker. Characters/presence were removed to be rebuilt later,
// so this component is a lean viewer + editor: it pans/zooms, switches floors,
// and persists layout edits. Rendering stays native Canvas 2D (no Phaser /
// Three) per the repo's "native intelligence" directive.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  type OfficeFloor,
} from "@/lib/office/layout";
import type { OfficeLayoutData } from "@/lib/office/layoutStore";
import type { MemberRole } from "@/lib/supabase/database.types";
import { buildWalls } from "@/lib/office/walls";
import { defaultZones } from "@/lib/office/zones";
import { drawOffice, type OfficeTheme } from "./render";
import { OfficeMapEditor } from "./OfficeMapEditor";

interface OfficeShellProps {
  /** Active org (used by the editor's save + asset actions). */
  orgId: string | null;
  /** Persisted (or default) office layout — possibly multi-floor. */
  layout: OfficeLayoutData;
  /** The member's org role — gates editing (owners/admins). */
  role?: MemberRole | null;
}

/** Read the theme CSS vars into an {@link OfficeTheme} the renderer consumes. */
function readTheme(el: HTMLElement): OfficeTheme {
  const cs = getComputedStyle(el);
  const triplet = (name: string, fallback: string) => {
    const v = cs.getPropertyValue(name).trim();
    return (v || fallback).split(/\s+/).join(",");
  };
  const s0 = triplet("--fx-surface-0", "5 9 18");
  const s1 = triplet("--fx-surface-1", "10 17 31");
  const s2 = triplet("--fx-surface-2", "16 27 46");
  const s3 = triplet("--fx-surface-3", "24 40 66");
  return {
    surface0: `rgb(${s0})`,
    surface1: `rgb(${s1})`,
    surface2: `rgb(${s2})`,
    surface3: `rgb(${s3})`,
    grid: `rgba(${s3},0.4)`,
    fg: cs.color || "#e5edf7",
    fgMuted: "rgba(148,163,184,0.85)",
  };
}

/** The floors of a layout: the stored building, or a single ground floor. */
function floorsOf(layout: OfficeLayoutData): OfficeFloor[] {
  if (layout.floors && layout.floors.length > 0) return layout.floors;
  return [{ id: "ground", name: "Office Floor", level: 0, rooms: layout.rooms }];
}

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 3.5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** A legend swatch + label. */
function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="h-2.5 w-2.5 rounded-[3px]"
        style={{ background: color }}
        aria-hidden
      />
      <span className="text-fg-secondary">{label}</span>
    </li>
  );
}

export function OfficeShell({ orgId, layout, role }: OfficeShellProps) {
  const [layoutState, setLayoutState] = useState<OfficeLayoutData>(layout);
  const floors = useMemo(() => floorsOf(layoutState), [layoutState]);

  const [activeFloorId, setActiveFloorId] = useState<string>(floors[0].id);
  // Keep the active floor valid if the building changes under us (e.g. a floor
  // is deleted in the editor).
  useEffect(() => {
    if (!floors.some((f) => f.id === activeFloorId)) {
      setActiveFloorId(floors[0].id);
    }
  }, [floors, activeFloorId]);

  const activeFloor = useMemo(
    () => floors.find((f) => f.id === activeFloorId) ?? floors[0],
    [floors, activeFloorId],
  );
  const rooms = activeFloor.rooms;
  const walls = useMemo(() => buildWalls(rooms), [rooms]);
  const zones = useMemo(() => defaultZones(rooms), [rooms]);

  const [editing, setEditing] = useState(false);
  const canEdit =
    role === "owner" || role === "admin" || role === undefined || role === null;

  // --- Render loop wiring -------------------------------------------------
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef<OfficeTheme | null>(null);
  // The active scene, mirrored into a ref so the rAF loop reads it without
  // re-subscribing every time the floor or an edit changes.
  const sceneRef = useRef({ rooms, walls, zones });
  sceneRef.current = { rooms, walls, zones };

  // Camera: a fit-to-floor baseline times a user zoom, plus a pan offset (px).
  const camRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const [zoomPct, setZoomPct] = useState(100);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const resetView = useCallback(() => {
    camRef.current = { zoom: 1, panX: 0, panY: 0 };
    setZoomPct(100);
  }, []);

  // Reset the view when switching floors so each floor opens framed.
  useEffect(() => {
    resetView();
  }, [activeFloorId, resetView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    themeRef.current = readTheme(wrap);

    const dprOf = () => Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const dpr = dprOf();
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let raf = 0;
    const frame = () => {
      const dpr = dprOf();
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const theme = themeRef.current;
      if (theme && cw > 0 && ch > 0) {
        const fit = Math.min(cw / OFFICE_WIDTH, ch / OFFICE_HEIGHT);
        const { zoom, panX, panY } = camRef.current;
        const scale = fit * zoom;
        const ox = (cw - OFFICE_WIDTH * scale) / 2 + panX;
        const oy = (ch - OFFICE_HEIGHT * scale) / 2 + panY;

        // Backdrop (unscaled) — a soft studio gradient behind the floor plan.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const bg = ctx.createLinearGradient(0, 0, 0, ch);
        bg.addColorStop(0, theme.surface1);
        bg.addColorStop(1, theme.surface0);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, cw, ch);

        // The office, under the camera transform.
        ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
        const scene = sceneRef.current;
        drawOffice({
          ctx,
          theme,
          rooms: scene.rooms,
          walls: scene.walls.walls,
          doorways: scene.walls.doorways,
          zones: scene.zones,
          time: performance.now(),
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onTheme = () => {
      if (wrapRef.current) themeRef.current = readTheme(wrapRef.current);
    };
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", onTheme);

    return () => {
      cancelAnimationFrame(raf);
      mql.removeEventListener("change", onTheme);
      ro.disconnect();
    };
  }, []);

  // Wheel-zoom about the cursor + drag-to-pan, attached natively so wheel can
  // be non-passive (preventDefault stops the page from scrolling).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const fit = Math.min(cw / OFFICE_WIDTH, ch / OFFICE_HEIGHT);
      const cam = camRef.current;
      const oldScale = fit * cam.zoom;
      const oldOx = (cw - OFFICE_WIDTH * oldScale) / 2 + cam.panX;
      const oldOy = (ch - OFFICE_HEIGHT * oldScale) / 2 + cam.panY;
      // Office-space point under the cursor, kept fixed across the zoom.
      const px = (cx - oldOx) / oldScale;
      const py = (cy - oldOy) / oldScale;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const zoom = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const scale = fit * zoom;
      const panX = cx - px * scale - (cw - OFFICE_WIDTH * scale) / 2;
      const panY = cy - py * scale - (ch - OFFICE_HEIGHT * scale) / 2;
      camRef.current = { zoom, panX, panY };
      setZoomPct(Math.round(zoom * 100));
    };

    const onDown = (e: PointerEvent) => {
      dragRef.current = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      camRef.current.panX += e.clientX - d.x;
      camRef.current.panY += e.clientY - d.y;
      dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      dragRef.current = null;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      canvas.style.cursor = "grab";
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const cam = camRef.current;
    const zoom = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    camRef.current = { ...cam, zoom };
    setZoomPct(Math.round(zoom * 100));
  }, []);

  const orderedFloors = useMemo(
    () => [...floors].sort((a, b) => b.level - a.level),
    [floors],
  );

  return (
    <div ref={wrapRef}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-[11px] uppercase tracking-[0.24em] text-fg-muted">
            Virtual Office
          </h1>
          <p className="text-lg font-semibold text-fg-primary">
            {activeFloor.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="mr-1 flex items-center gap-1 rounded-md border border-surface-3/50 px-1 py-0.5">
            <button
              type="button"
              onClick={() => zoomBy(1 / 1.2)}
              className="px-1.5 text-fg-secondary transition hover:text-fg-primary"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="w-10 text-center text-xs tabular-nums text-fg-muted">
              {zoomPct}%
            </span>
            <button
              type="button"
              onClick={() => zoomBy(1.2)}
              className="px-1.5 text-fg-secondary transition hover:text-fg-primary"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={resetView}
            className="rounded-md border border-surface-3/50 px-2.5 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2"
          >
            Reset view
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition ${
                editing
                  ? "border-gold-400/60 bg-gold-400/10 text-fg-primary"
                  : "border-surface-3/50 text-fg-secondary hover:bg-surface-2"
              }`}
            >
              {editing ? "Close MapMaker" : "Edit map"}
            </button>
          )}
          <Link
            href="/office/analytics"
            className="rounded-md border border-surface-3/50 px-2.5 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2"
          >
            Analytics
          </Link>
        </div>
      </header>

      {/* Brass hairline rule — an institutional divider under the header. */}
      <div className="mb-4 h-px bg-gradient-to-r from-gold-400/50 via-gold-400/15 to-transparent" />

      {editing && canEdit && (
        <div className="mb-4 rounded-xl border border-surface-3/60 bg-surface-1 p-4">
          <OfficeMapEditor
            orgId={orgId ?? ""}
            initial={layoutState}
            activeFloorId={activeFloor.id}
            onFloorChange={setActiveFloorId}
            onChange={setLayoutState}
            onSaved={(d) => {
              setLayoutState(d);
              setEditing(false);
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
        {/* Floor plan */}
        <div className="overflow-hidden rounded-2xl border border-surface-3/50 bg-surface-1 shadow-[0_16px_50px_-12px_rgba(0,0,0,0.6)] ring-1 ring-gold-400/10">
          <canvas
            ref={canvasRef}
            className="block h-[68vh] w-full touch-none"
            style={{ cursor: "grab" }}
            aria-label={`Floor plan — ${activeFloor.name}`}
          />
        </div>

        {/* Side panel — floor switcher + legend */}
        <aside className="flex flex-col gap-4">
          <section>
            <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
              Floors
            </h2>
            <ul className="flex flex-col gap-1.5">
              {orderedFloors.map((f) => {
                const active = f.id === activeFloor.id;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setActiveFloorId(f.id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                        active
                          ? "border-gold-400/60 bg-gold-400/10 text-fg-primary"
                          : "border-surface-3/50 text-fg-secondary hover:bg-surface-2"
                      }`}
                    >
                      <span className="font-medium">{f.name}</span>
                      <span className="ml-2 shrink-0 font-mono text-[10px] text-fg-muted">
                        {f.rooms.length} rooms
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
              Interaction zones
            </h2>
            <ul className="flex flex-col gap-1.5 text-xs">
              <LegendRow color="#c9a24a" label="Meeting — shared room call" />
              <LegendRow color="#8a7096" label="Silent — focus, muted audio" />
              <LegendRow color="#a6774d" label="Social — casual collisions" />
              <LegendRow color="#3d7387" label="Embed — whiteboard / board" />
              <LegendRow color="#5a7797" label="Spawn — where people arrive" />
            </ul>
          </section>

          <p className="rounded-lg border border-surface-3/50 bg-surface-2/40 p-3 text-[11px] leading-relaxed text-fg-muted">
            Drag to pan, scroll to zoom. {canEdit ? "Open " : "The "}
            <span className="text-fg-secondary">MapMaker</span>
            {canEdit ? " to add floors and rooms, place furniture, and rearrange the building." : " lets owners shape the building."}
          </p>
        </aside>
      </div>
    </div>
  );
}
