"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { CanvasElement } from "@/lib/supabase/database.types";
import { upsertElement, deleteElement } from "./canvas-actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tool = "select" | "sticky" | "text" | "shape" | "arrow" | "pan";
type ShapeKind = "rect" | "circle";

interface Cursor {
  userId: string;
  initials: string;
  color: string;
  x: number;
  y: number;
}

interface Props {
  canvasId: string;
  initialElements: CanvasElement[];
  currentUserId: string;
  currentUserInitials: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STICKY_COLORS = ["#FDE68A", "#BBF7D0", "#BAE6FD", "#FBCFE8"] as const;
const CURSOR_COLORS = [
  "#F59E0B","#10B981","#3B82F6","#EC4899",
  "#8B5CF6","#EF4444","#14B8A6","#F97316",
];
const MIN_SIZE = 20;

function uid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Arrow SVG path between two elements
// ---------------------------------------------------------------------------

function arrowPath(
  from: CanvasElement,
  to: CanvasElement,
): string {
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h / 2;
  const x2 = to.x + to.w / 2;
  const y2 = to.y + to.h / 2;
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} Q ${cx} ${y1} ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CollaborativeCanvas({
  canvasId,
  initialElements,
  currentUserId,
  currentUserInitials,
}: Props) {
  const [elements, setElements] = useState<CanvasElement[]>(initialElements);
  const [tool, setTool] = useState<Tool>("select");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [stickyColor, setStickyColor] = useState<string>(STICKY_COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const [arrowFrom, setArrowFrom] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>("");

  // Pan / viewport
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0 });

  // Drawing shape
  const drawRef = useRef<{ active: boolean; startX: number; startY: number; id: string } | null>(null);

  // Dragging element
  const dragRef = useRef<{ id: string; startX: number; startY: number; elemX: number; elemY: number } | null>(null);

  // Resizing element
  const resizeRef = useRef<{ id: string; startX: number; startY: number; elemW: number; elemH: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const supabase = createClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Map userId → cursor color (stable per user)
  const cursorColorMap = useRef<Record<string, string>>({});
  function getCursorColor(userId: string): string {
    if (!cursorColorMap.current[userId]) {
      const idx = Object.keys(cursorColorMap.current).length % CURSOR_COLORS.length;
      cursorColorMap.current[userId] = CURSOR_COLORS[idx];
    }
    return cursorColorMap.current[userId];
  }

  // ---------------------------------------------------------------------------
  // Realtime setup
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const channel = supabase
      .channel(`canvas:${canvasId}`)
      .on("broadcast", { event: "element_update" }, ({ payload }: { payload: CanvasElement }) => {
        setElements((prev) => {
          const idx = prev.findIndex((e) => e.id === payload.id);
          if (idx === -1) return [...prev, payload];
          const next = [...prev];
          next[idx] = payload;
          return next;
        });
      })
      .on("broadcast", { event: "element_delete" }, ({ payload }: { payload: { id: string } }) => {
        setElements((prev) => prev.filter((e) => e.id !== payload.id));
      })
      .on("broadcast", { event: "cursor_move" }, ({ payload }: { payload: Cursor }) => {
        if (payload.userId === currentUserId) return;
        setCursors((prev) => {
          const idx = prev.findIndex((c) => c.userId === payload.userId);
          if (idx === -1) return [...prev, payload];
          const next = [...prev];
          next[idx] = payload;
          return next;
        });
      })
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId]);

  // ---------------------------------------------------------------------------
  // Broadcast helpers
  // ---------------------------------------------------------------------------

  const broadcastElement = useCallback((el: CanvasElement) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "element_update",
      payload: el,
    });
  }, []);

  const broadcastDelete = useCallback((id: string) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "element_delete",
      payload: { id },
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Persist helpers (fire-and-forget via FormData)
  // ---------------------------------------------------------------------------

  function persistElement(el: CanvasElement) {
    const fd = new FormData();
    (Object.entries(el) as [string, unknown][]).forEach(([k, v]) => {
      if (v != null) fd.set(k, String(v));
    });
    upsertElement(fd).catch(() => {});
  }

  function persistDelete(id: string, cId: string) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("canvas_id", cId);
    deleteElement(fd).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Add / update element
  // ---------------------------------------------------------------------------

  function addElement(el: CanvasElement) {
    setElements((prev) => [...prev, el]);
    broadcastElement(el);
    persistElement(el);
  }

  function updateElement(el: CanvasElement) {
    setElements((prev) =>
      prev.map((e) => (e.id === el.id ? el : e)),
    );
    broadcastElement(el);
    persistElement(el);
  }

  function removeElement(id: string) {
    setElements((prev) => prev.filter((e) => e.id !== id));
    broadcastDelete(id);
    persistDelete(id, canvasId);
    if (selectedId === id) setSelectedId(null);
  }

  // ---------------------------------------------------------------------------
  // SVG coordinate from mouse event
  // ---------------------------------------------------------------------------

  function svgCoords(e: React.MouseEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: e.clientX - rect.left - pan.x,
      y: e.clientY - rect.top - pan.y,
    };
  }

  // ---------------------------------------------------------------------------
  // Mouse move (canvas)
  // ---------------------------------------------------------------------------

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;

    // Broadcast cursor
    channelRef.current?.send({
      type: "broadcast",
      event: "cursor_move",
      payload: {
        userId: currentUserId,
        initials: currentUserInitials,
        color: getCursorColor(currentUserId),
        x: rawX - pan.x,
        y: rawY - pan.y,
      } satisfies Cursor,
    });

    // Pan
    if (panRef.current.active) {
      const dx = rawX - panRef.current.startX;
      const dy = rawY - panRef.current.startY;
      setPan({ x: panRef.current.panX + dx, y: panRef.current.panY + dy });
      return;
    }

    // Drag element
    if (dragRef.current) {
      const { id, startX, startY, elemX, elemY } = dragRef.current;
      const dx = rawX - pan.x - startX;
      const dy = rawY - pan.y - startY;
      const el = elements.find((e) => e.id === id);
      if (el) {
        const updated = { ...el, x: elemX + dx, y: elemY + dy, updated_at: new Date().toISOString() };
        setElements((prev) => prev.map((e) => (e.id === id ? updated : e)));
      }
      return;
    }

    // Resize element
    if (resizeRef.current) {
      const { id, startX, startY, elemW, elemH } = resizeRef.current;
      const dx = rawX - pan.x - startX;
      const dy = rawY - pan.y - startY;
      const el = elements.find((e) => e.id === id);
      if (el) {
        const updated = {
          ...el,
          w: Math.max(MIN_SIZE, elemW + dx),
          h: Math.max(MIN_SIZE, elemH + dy),
          updated_at: new Date().toISOString(),
        };
        setElements((prev) => prev.map((e) => (e.id === id ? updated : e)));
      }
      return;
    }

    // Draw shape
    if (drawRef.current?.active) {
      const { startX, startY, id } = drawRef.current;
      const { x, y } = svgCoords(e);
      const rx = Math.min(startX, x);
      const ry = Math.min(startY, y);
      const rw = Math.max(MIN_SIZE, Math.abs(x - startX));
      const rh = Math.max(MIN_SIZE, Math.abs(y - startY));
      const el = elements.find((ev) => ev.id === id);
      if (el) {
        setElements((prev) =>
          prev.map((ev) =>
            ev.id === id ? { ...ev, x: rx, y: ry, w: rw, h: rh } : ev,
          ),
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mouse up
  // ---------------------------------------------------------------------------

  function handleMouseUp(e: React.MouseEvent<SVGSVGElement>) {
    panRef.current.active = false;

    if (dragRef.current) {
      const id = dragRef.current.id;
      dragRef.current = null;
      const el = elements.find((ev) => ev.id === id);
      if (el) {
        broadcastElement(el);
        persistElement(el);
      }
      return;
    }

    if (resizeRef.current) {
      const id = resizeRef.current.id;
      resizeRef.current = null;
      const el = elements.find((ev) => ev.id === id);
      if (el) {
        broadcastElement(el);
        persistElement(el);
      }
      return;
    }

    if (drawRef.current?.active) {
      const id = drawRef.current.id;
      drawRef.current = { ...drawRef.current, active: false };
      const el = elements.find((ev) => ev.id === id);
      if (el && el.w >= MIN_SIZE && el.h >= MIN_SIZE) {
        broadcastElement(el);
        persistElement(el);
      } else if (el) {
        // Too small — remove
        setElements((prev) => prev.filter((ev) => ev.id !== id));
      }
      drawRef.current = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Canvas click (tool actions)
  // ---------------------------------------------------------------------------

  function handleCanvasClick(e: React.MouseEvent<SVGSVGElement>) {
    if (e.target !== svgRef.current && (e.target as SVGElement).dataset.bg !== "true") return;

    const { x, y } = svgCoords(e);
    setSelectedId(null);
    setArrowFrom(null);

    if (tool === "sticky") {
      const el: CanvasElement = {
        id: uid(),
        canvas_id: canvasId,
        organization_id: "",
        type: "sticky",
        x: x - 100,
        y: y - 60,
        w: 200,
        h: 120,
        content: "",
        color: stickyColor,
        created_by: currentUserId,
        updated_at: new Date().toISOString(),
      };
      addElement(el);
      setEditingId(el.id);
      setEditText("");
      return;
    }

    if (tool === "text") {
      const el: CanvasElement = {
        id: uid(),
        canvas_id: canvasId,
        organization_id: "",
        type: "text",
        x: x - 80,
        y: y - 16,
        w: 160,
        h: 32,
        content: "",
        color: "#E5E7EB",
        created_by: currentUserId,
        updated_at: new Date().toISOString(),
      };
      addElement(el);
      setEditingId(el.id);
      setEditText("");
    }
  }

  // ---------------------------------------------------------------------------
  // Canvas mouse down (pan + shape draw)
  // ---------------------------------------------------------------------------

  function handleCanvasMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    const isBg =
      e.target === svgRef.current ||
      (e.target as SVGElement).dataset.bg === "true";

    if (tool === "pan" || (e.button === 1)) {
      const rect = svgRef.current!.getBoundingClientRect();
      panRef.current = {
        active: true,
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        panX: pan.x,
        panY: pan.y,
      };
      e.preventDefault();
      return;
    }

    if (tool === "shape" && isBg) {
      const { x, y } = svgCoords(e);
      const id = uid();
      const el: CanvasElement = {
        id,
        canvas_id: canvasId,
        organization_id: "",
        type: "shape",
        x,
        y,
        w: MIN_SIZE,
        h: MIN_SIZE,
        content: "",
        color: "#6366F1",
        shape_kind: shapeKind,
        created_by: currentUserId,
        updated_at: new Date().toISOString(),
      };
      setElements((prev) => [...prev, el]);
      drawRef.current = { active: true, startX: x, startY: y, id };
      e.preventDefault();
    }
  }

  // ---------------------------------------------------------------------------
  // Element interactions
  // ---------------------------------------------------------------------------

  function handleElementMouseDown(
    e: React.MouseEvent,
    el: CanvasElement,
  ) {
    e.stopPropagation();

    if (tool === "arrow") {
      if (!arrowFrom) {
        setArrowFrom(el.id);
      } else if (arrowFrom !== el.id) {
        // Create arrow
        const arrow: CanvasElement = {
          id: uid(),
          canvas_id: canvasId,
          organization_id: "",
          type: "arrow",
          x: 0, y: 0, w: 0, h: 0,
          content: "",
          color: "#9CA3AF",
          from_id: arrowFrom,
          to_id: el.id,
          created_by: currentUserId,
          updated_at: new Date().toISOString(),
        };
        addElement(arrow);
        setArrowFrom(null);
      }
      return;
    }

    if (tool === "select" || tool === "pan") {
      setSelectedId(el.id);
      const rect = svgRef.current!.getBoundingClientRect();
      dragRef.current = {
        id: el.id,
        startX: e.clientX - rect.left - pan.x,
        startY: e.clientY - rect.top - pan.y,
        elemX: el.x,
        elemY: el.y,
      };
    }
  }

  function handleResizeMouseDown(e: React.MouseEvent, el: CanvasElement) {
    e.stopPropagation();
    const rect = svgRef.current!.getBoundingClientRect();
    resizeRef.current = {
      id: el.id,
      startX: e.clientX - rect.left - pan.x,
      startY: e.clientY - rect.top - pan.y,
      elemW: el.w,
      elemH: el.h,
    };
  }

  function handleElementDoubleClick(el: CanvasElement) {
    if (el.type === "arrow") return;
    setEditingId(el.id);
    setEditText(el.content);
  }

  function commitEdit() {
    if (!editingId) return;
    const el = elements.find((e) => e.id === editingId);
    if (el) {
      const updated = { ...el, content: editText, updated_at: new Date().toISOString() };
      updateElement(updated);
    }
    setEditingId(null);
    setEditText("");
  }

  // ---------------------------------------------------------------------------
  // Keyboard delete
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        editingId ||
        (e.target as HTMLElement).tagName === "TEXTAREA" ||
        (e.target as HTMLElement).tagName === "INPUT"
      ) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        removeElement(selectedId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, editingId]);

  // ---------------------------------------------------------------------------
  // Render element
  // ---------------------------------------------------------------------------

  function renderElement(el: CanvasElement) {
    const isSelected = selectedId === el.id;
    const isEditing = editingId === el.id;

    if (el.type === "arrow") {
      const from = elements.find((e) => e.id === el.from_id);
      const to = elements.find((e) => e.id === el.to_id);
      if (!from || !to) return null;
      const path = arrowPath(from, to);
      return (
        <g key={el.id}>
          <path
            d={path}
            stroke={el.color}
            strokeWidth={2}
            fill="none"
            markerEnd="url(#arrowhead)"
            onMouseDown={(e) => handleElementMouseDown(e, el)}
            className="cursor-pointer"
          />
        </g>
      );
    }

    const commonProps = {
      onMouseDown: (e: React.MouseEvent) => handleElementMouseDown(e, el),
      onDoubleClick: () => handleElementDoubleClick(el),
      style: { cursor: tool === "select" ? "move" : "default" },
    };

    let shape: React.ReactNode;

    if (el.type === "shape") {
      if (el.shape_kind === "circle") {
        shape = (
          <ellipse
            cx={el.x + el.w / 2}
            cy={el.y + el.h / 2}
            rx={el.w / 2}
            ry={el.h / 2}
            fill={el.color}
            stroke={isSelected ? "#F59E0B" : "transparent"}
            strokeWidth={2}
            {...commonProps}
          />
        );
      } else {
        shape = (
          <rect
            x={el.x}
            y={el.y}
            width={el.w}
            height={el.h}
            rx={6}
            fill={el.color}
            stroke={isSelected ? "#F59E0B" : "transparent"}
            strokeWidth={2}
            {...commonProps}
          />
        );
      }
    } else if (el.type === "sticky") {
      shape = (
        <g {...commonProps}>
          <rect
            x={el.x}
            y={el.y}
            width={el.w}
            height={el.h}
            rx={4}
            fill={el.color}
            stroke={isSelected ? "#F59E0B" : "rgba(0,0,0,0.15)"}
            strokeWidth={isSelected ? 2 : 1}
          />
          {/* fold corner */}
          <path
            d={`M ${el.x + el.w - 16} ${el.y} L ${el.x + el.w} ${el.y + 16} L ${el.x + el.w} ${el.y} Z`}
            fill="rgba(0,0,0,0.12)"
          />
          {isEditing ? (
            <foreignObject x={el.x + 8} y={el.y + 8} width={el.w - 16} height={el.h - 16}>
              <textarea
                xmlns={"http://www.w3.org/1999/xhtml" as never}
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === "Escape") commitEdit(); }}
                className="w-full h-full resize-none bg-transparent text-xs text-gray-800 outline-none"
                placeholder="Type here…"
              />
            </foreignObject>
          ) : (
            <text
              x={el.x + 8}
              y={el.y + 20}
              fontSize={12}
              fill="#1F2937"
              className="select-none pointer-events-none"
            >
              {el.content.split("\n").map((line, i) => (
                <tspan key={i} x={el.x + 8} dy={i === 0 ? 0 : 16}>
                  {line}
                </tspan>
              ))}
            </text>
          )}
        </g>
      );
    } else if (el.type === "text") {
      shape = (
        <g {...commonProps}>
          {isSelected && (
            <rect
              x={el.x - 2}
              y={el.y - 2}
              width={el.w + 4}
              height={el.h + 4}
              rx={2}
              fill="transparent"
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="4 2"
            />
          )}
          {isEditing ? (
            <foreignObject x={el.x} y={el.y} width={Math.max(120, el.w)} height={Math.max(32, el.h)}>
              <input
                xmlns={"http://www.w3.org/1999/xhtml" as never}
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") commitEdit(); }}
                className="bg-transparent text-sm font-medium text-fg-primary outline-none border-b border-gold-400 w-full"
                placeholder="Text…"
              />
            </foreignObject>
          ) : (
            <text
              x={el.x}
              y={el.y + 16}
              fontSize={14}
              fontWeight={500}
              fill="var(--fg-primary, #F9FAFB)"
              className="select-none pointer-events-none"
            >
              {el.content || (
                <tspan fill="var(--fg-muted, #9CA3AF)" fontStyle="italic">
                  Double-click to edit
                </tspan>
              )}
            </text>
          )}
        </g>
      );
    } else {
      return null;
    }

    return (
      <g key={el.id}>
        {shape}
        {/* Resize handle */}
        {isSelected && el.type !== "arrow" && (
          <rect
            x={el.x + el.w - 8}
            y={el.y + el.h - 8}
            width={10}
            height={10}
            rx={2}
            fill="#F59E0B"
            className="cursor-se-resize"
            onMouseDown={(e) => { e.stopPropagation(); handleResizeMouseDown(e, el); }}
          />
        )}
      </g>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const toolButtons: { id: Tool; label: string; icon: string }[] = [
    { id: "select", label: "Select", icon: "↖" },
    { id: "pan", label: "Pan", icon: "✋" },
    { id: "sticky", label: "Sticky", icon: "📝" },
    { id: "text", label: "Text", icon: "T" },
    { id: "shape", label: "Shape", icon: "▭" },
    { id: "arrow", label: "Arrow", icon: "→" },
  ];

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-line bg-surface-1 px-3 py-2 z-10">
        {toolButtons.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTool(t.id); setArrowFrom(null); }}
            title={t.label}
            className={[
              "flex h-8 w-8 items-center justify-center rounded text-sm font-mono transition",
              tool === t.id
                ? "bg-gold-400/20 text-gold-400 ring-1 ring-gold-400/40"
                : "text-fg-muted hover:bg-surface-2 hover:text-fg-primary",
            ].join(" ")}
          >
            {t.icon}
          </button>
        ))}

        {/* Shape kind picker */}
        {tool === "shape" && (
          <div className="ml-2 flex items-center gap-1">
            {(["rect", "circle"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setShapeKind(k)}
                className={[
                  "rounded px-2 py-0.5 text-xs transition",
                  shapeKind === k
                    ? "bg-gold-400/20 text-gold-400"
                    : "text-fg-muted hover:bg-surface-2",
                ].join(" ")}
              >
                {k === "rect" ? "Rect" : "Circle"}
              </button>
            ))}
          </div>
        )}

        {/* Sticky color picker */}
        {tool === "sticky" && (
          <div className="ml-2 flex items-center gap-1.5">
            {STICKY_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setStickyColor(c)}
                className="h-5 w-5 rounded-full border-2 transition"
                style={{
                  background: c,
                  borderColor: stickyColor === c ? "#F59E0B" : "transparent",
                }}
              />
            ))}
          </div>
        )}

        {/* Arrow from indicator */}
        {tool === "arrow" && arrowFrom && (
          <span className="ml-2 text-xs text-emerald-400 animate-pulse">
            Click target element…
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Collaborator cursors count */}
          {cursors.length > 0 && (
            <span className="text-xs text-fg-muted">
              {cursors.length} online
            </span>
          )}
          {/* Delete selected */}
          {selectedId && (
            <button
              onClick={() => removeElement(selectedId)}
              className="rounded px-2 py-0.5 text-xs text-status-error hover:bg-surface-2"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          className={[
            "h-full w-full select-none",
            tool === "pan" ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          ].join(" ")}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#9CA3AF" />
            </marker>
            {/* Dot-grid pattern */}
            <pattern
              id="dot-grid"
              x={pan.x % 32}
              y={pan.y % 32}
              width={32}
              height={32}
              patternUnits="userSpaceOnUse"
            >
              <circle cx={1} cy={1} r={1} fill="rgba(255,255,255,0.08)" />
            </pattern>
          </defs>

          {/* Background */}
          <rect
            width="100%"
            height="100%"
            fill="url(#dot-grid)"
            data-bg="true"
          />

          {/* All elements */}
          <g transform={`translate(${pan.x}, ${pan.y})`}>
            {elements.map(renderElement)}
          </g>

          {/* Remote cursors (in screen coords, no pan) */}
          {cursors.map((c) => (
            <g
              key={c.userId}
              transform={`translate(${c.x + pan.x}, ${c.y + pan.y})`}
              className="pointer-events-none"
            >
              <circle r={14} fill={getCursorColor(c.userId)} opacity={0.85} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10}
                fontWeight={700}
                fill="#fff"
              >
                {c.initials.slice(0, 2).toUpperCase()}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
