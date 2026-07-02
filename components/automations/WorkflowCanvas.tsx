"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CanvasEdge,
  CanvasLayout,
  CanvasNode,
  DEFAULT_NODE_TYPES,
} from "@/lib/automation-canvas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeType = CanvasNode["type"];

interface Props {
  automationId?: string;
  initialLayout?: CanvasLayout;
  onChange?: (layout: CanvasLayout) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_WIDTH = 160;
const NODE_HEIGHT = 64;

const TYPE_COLORS: Record<NodeType, { bg: string; header: string; label: string }> = {
  trigger: { bg: "#eff6ff", header: "#2563eb", label: "Trigger" },
  condition: { bg: "#fffbeb", header: "#d97706", label: "Condition" },
  action: { bg: "#f0fdf4", header: "#16a34a", label: "Action" },
  wait: { bg: "#f9fafb", header: "#6b7280", label: "Wait" },
};

const PALETTE_TYPES: NodeType[] = ["trigger", "condition", "action", "wait"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `node_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function generateEdgeId(source: string, target: string): string {
  return `edge_${source}_${target}`;
}

// ---------------------------------------------------------------------------
// SVG Edges
// ---------------------------------------------------------------------------

function EdgeLayer({
  edges,
  nodes,
}: {
  edges: CanvasEdge[];
  nodes: CanvasNode[];
}) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const src = nodeMap.get(edge.source);
        const tgt = nodeMap.get(edge.target);
        if (!src || !tgt) return null;

        const x1 = src.position.x + NODE_WIDTH;
        const y1 = src.position.y + NODE_HEIGHT / 2;
        const x2 = tgt.position.x;
        const y2 = tgt.position.y + NODE_HEIGHT / 2;
        const cx1 = x1 + (x2 - x1) / 2;
        const cy1 = y1;
        const cx2 = x1 + (x2 - x1) / 2;
        const cy2 = y2;

        return (
          <path
            key={edge.id}
            d={`M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`}
            stroke="#94a3b8"
            strokeWidth={2}
            fill="none"
            markerEnd="url(#arrowhead)"
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Node Card
// ---------------------------------------------------------------------------

function NodeCard({
  node,
  isSelected,
  onDelete,
  onLabelChange,
  onDragStart,
  onConnectClick,
}: {
  node: CanvasNode;
  isSelected: boolean;
  onDelete: (id: string) => void;
  onLabelChange: (id: string, label: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onConnectClick: (id: string) => void;
}) {
  const colors = TYPE_COLORS[node.type];
  const [hovered, setHovered] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, node.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: node.position.x,
        top: node.position.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        backgroundColor: colors.bg,
        border: isSelected
          ? `2px solid ${colors.header}`
          : "2px solid #e2e8f0",
        borderRadius: 8,
        boxShadow: hovered
          ? "0 4px 12px rgba(0,0,0,0.12)"
          : "0 1px 4px rgba(0,0,0,0.06)",
        cursor: "grab",
        userSelect: "none",
        overflow: "visible",
        zIndex: isSelected ? 10 : 1,
        transition: "box-shadow 0.15s, border-color 0.15s",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          height: 20,
          backgroundColor: colors.header,
          borderRadius: "6px 6px 0 0",
          display: "flex",
          alignItems: "center",
          paddingLeft: 8,
          paddingRight: 4,
          gap: 4,
        }}
      >
        <span
          style={{
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          {colors.label}
        </span>
        {/* Delete button */}
        {hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.id);
            }}
            style={{
              background: "rgba(255,255,255,0.25)",
              border: "none",
              borderRadius: 3,
              color: "#fff",
              cursor: "pointer",
              fontSize: 11,
              lineHeight: 1,
              padding: "1px 4px",
              fontWeight: 700,
            }}
            title="Delete node"
          >
            ×
          </button>
        )}
      </div>

      {/* Label */}
      <div
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) =>
          onLabelChange(node.id, e.currentTarget.textContent ?? node.data.label)
        }
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: "6px 8px",
          fontSize: 12,
          color: "#1e293b",
          outline: "none",
          height: NODE_HEIGHT - 20,
          overflow: "hidden",
          cursor: "text",
        }}
      >
        {node.data.label}
      </div>

      {/* Connect handle (right edge) */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onConnectClick(node.id);
        }}
        title="Connect"
        style={{
          position: "absolute",
          right: -10,
          top: "50%",
          transform: "translateY(-50%)",
          width: 18,
          height: 18,
          borderRadius: "50%",
          backgroundColor: isSelected ? colors.header : "#cbd5e1",
          border: "2px solid #fff",
          cursor: "crosshair",
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background-color 0.15s",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WorkflowCanvas({
  automationId,
  initialLayout,
  onChange,
}: Props) {
  const [nodes, setNodes] = useState<CanvasNode[]>(
    initialLayout?.nodes ?? []
  );
  const [edges, setEdges] = useState<CanvasEdge[]>(
    initialLayout?.edges ?? []
  );
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Track drag offset for repositioning nodes
  const dragOffset = useRef({ x: 0, y: 0 });
  const draggingNodeId = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // Layout helpers
  // -------------------------------------------------------------------------

  const currentLayout = useCallback(
    (): CanvasLayout => ({ nodes, edges }),
    [nodes, edges]
  );

  // -------------------------------------------------------------------------
  // Palette drag start
  // -------------------------------------------------------------------------

  function onPaletteDragStart(e: React.DragEvent, type: NodeType) {
    e.dataTransfer.setData("palette-type", type);
  }

  // -------------------------------------------------------------------------
  // Canvas drop (new node from palette)
  // -------------------------------------------------------------------------

  function onCanvasDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const canvasRect = e.currentTarget.getBoundingClientRect();

    const paletteType = e.dataTransfer.getData("palette-type") as NodeType | "";
    if (paletteType && PALETTE_TYPES.includes(paletteType as NodeType)) {
      const x = e.clientX - canvasRect.left - NODE_WIDTH / 2;
      const y = e.clientY - canvasRect.top - NODE_HEIGHT / 2;
      const newNode: CanvasNode = {
        id: generateId(),
        type: paletteType as NodeType,
        position: { x: Math.max(0, x), y: Math.max(0, y) },
        data: {
          label: TYPE_COLORS[paletteType as NodeType].label,
          config: { ...DEFAULT_NODE_TYPES[paletteType as NodeType] },
        },
      };
      setNodes((prev) => [...prev, newNode]);
      return;
    }

    // Repositioning existing node
    const movingId = e.dataTransfer.getData("moving-node-id");
    if (movingId) {
      const x = e.clientX - canvasRect.left - dragOffset.current.x;
      const y = e.clientY - canvasRect.top - dragOffset.current.y;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === movingId
            ? { ...n, position: { x: Math.max(0, x), y: Math.max(0, y) } }
            : n
        )
      );
    }
  }

  // -------------------------------------------------------------------------
  // Node drag start (repositioning)
  // -------------------------------------------------------------------------

  function onNodeDragStart(e: React.DragEvent, id: string) {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    e.dataTransfer.setData("moving-node-id", id);
    draggingNodeId.current = id;
  }

  // -------------------------------------------------------------------------
  // Connect nodes
  // -------------------------------------------------------------------------

  function onConnectClick(id: string) {
    if (!connectingFrom) {
      setConnectingFrom(id);
    } else if (connectingFrom !== id) {
      // Avoid duplicate edges
      const exists = edges.some(
        (ed) => ed.source === connectingFrom && ed.target === id
      );
      if (!exists) {
        const newEdge: CanvasEdge = {
          id: generateEdgeId(connectingFrom, id),
          source: connectingFrom,
          target: id,
        };
        setEdges((prev) => [...prev, newEdge]);
      }
      setConnectingFrom(null);
    } else {
      // Clicked same node — cancel
      setConnectingFrom(null);
    }
  }

  function onCanvasClick() {
    if (connectingFrom) setConnectingFrom(null);
  }

  // -------------------------------------------------------------------------
  // Delete / label
  // -------------------------------------------------------------------------

  function onDeleteNode(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
    if (connectingFrom === id) setConnectingFrom(null);
  }

  function onLabelChange(id: string, label: string) {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label: label.trim() || n.data.label } } : n
      )
    );
  }

  // -------------------------------------------------------------------------
  // Clear
  // -------------------------------------------------------------------------

  function onClear() {
    setNodes([]);
    setEdges([]);
    setConnectingFrom(null);
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  async function onSave() {
    const layout = currentLayout();
    onChange?.(layout);

    if (!automationId) return;

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/automations/${automationId}/canvas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layout),
      });
      if (!res.ok) {
        const text = await res.text();
        setSaveError(`Save failed: ${text}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: "var(--font-sans, sans-serif)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          borderBottom: "1px solid #e2e8f0",
          backgroundColor: "#fff",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, color: "#64748b" }}>
          {nodes.length} node{nodes.length !== 1 ? "s" : ""}
          {connectingFrom && (
            <span style={{ marginLeft: 8, color: "#2563eb" }}>
              · Click a node to connect
            </span>
          )}
        </span>
        <div style={{ flex: 1 }} />
        {saveError && (
          <span style={{ fontSize: 12, color: "#dc2626" }}>{saveError}</span>
        )}
        <button
          onClick={onClear}
          style={{
            padding: "5px 12px",
            fontSize: 13,
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
            color: "#64748b",
          }}
        >
          Clear
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            padding: "5px 14px",
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            borderRadius: 6,
            background: saving ? "#93c5fd" : "#2563eb",
            color: "#fff",
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Palette */}
        <div
          style={{
            width: 200,
            flexShrink: 0,
            borderRight: "1px solid #e2e8f0",
            backgroundColor: "#f8fafc",
            padding: "16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 600,
              color: "#94a3b8",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Node Types
          </p>
          {PALETTE_TYPES.map((type) => {
            const c = TYPE_COLORS[type];
            return (
              <div
                key={type}
                draggable
                onDragStart={(e) => onPaletteDragStart(e, type)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  backgroundColor: c.bg,
                  border: `2px solid ${c.header}`,
                  cursor: "grab",
                  fontSize: 13,
                  fontWeight: 600,
                  color: c.header,
                  userSelect: "none",
                  textAlign: "center",
                }}
                title={`Drag to add a ${c.label} node`}
              >
                {c.label}
              </div>
            );
          })}
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 11,
              color: "#94a3b8",
              lineHeight: 1.5,
            }}
          >
            Drag a type onto the canvas to add a node. Click a node&apos;s right
            handle to connect it.
          </p>
        </div>

        {/* Canvas */}
        <div
          onDrop={onCanvasDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={onCanvasClick}
          style={{
            flex: 1,
            position: "relative",
            overflow: "auto",
            backgroundColor: "#f1f5f9",
            backgroundImage:
              "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            minHeight: 400,
          }}
        >
          <EdgeLayer edges={edges} nodes={nodes} />
          {nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              isSelected={connectingFrom === node.id}
              onDelete={onDeleteNode}
              onLabelChange={onLabelChange}
              onDragStart={onNodeDragStart}
              onConnectClick={onConnectClick}
            />
          ))}
          {nodes.length === 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <p style={{ color: "#94a3b8", fontSize: 14 }}>
                Drag a node type from the left panel to get started
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
