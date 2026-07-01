"use client";

import React, { useMemo } from "react";

interface TaskStep {
  id: string;
  title: string;
  agent_key: string;
  status: "pending" | "pending_dependency" | "in_progress" | "completed" | "failed";
  depends_on: string[];
  order_index: number;
}

interface Props {
  steps: TaskStep[];
  onStepClick?: (step: TaskStep) => void;
}

const NODE_WIDTH = 120;
const NODE_HEIGHT = 48;
const COL_GAP = 80;
const ROW_GAP = 24;
const PADDING = 24;

type StatusKey = TaskStep["status"];

const STATUS_FILL: Record<StatusKey, string> = {
  pending: "var(--surface-2)",
  pending_dependency: "var(--surface-1)",
  in_progress: "var(--gold-400, #f59e0b)",
  completed: "var(--green-600, #16a34a)",
  failed: "var(--red-600, #dc2626)",
};

const STATUS_STROKE: Record<StatusKey, string> = {
  pending: "var(--border, #334155)",
  pending_dependency: "var(--border-muted, #475569)",
  in_progress: "var(--gold-500, #d97706)",
  completed: "var(--green-700, #15803d)",
  failed: "var(--red-700, #b91c1c)",
};

const STATUS_TEXT: Record<StatusKey, string> = {
  pending: "var(--text-primary, #f1f5f9)",
  pending_dependency: "var(--text-muted, #94a3b8)",
  in_progress: "var(--text-inverse, #0f172a)",
  completed: "var(--text-inverse, #fff)",
  failed: "var(--text-inverse, #fff)",
};

interface NodeLayout {
  step: TaskStep;
  x: number;
  y: number;
  cx: number; // center x
  cy: number; // center y
}

function useLayout(steps: TaskStep[]): {
  nodes: NodeLayout[];
  svgWidth: number;
  svgHeight: number;
} {
  return useMemo(() => {
    if (steps.length === 0) return { nodes: [], svgWidth: 0, svgHeight: 0 };

    // Group by order_index
    const colMap = new Map<number, TaskStep[]>();
    for (const step of steps) {
      const col = step.order_index;
      if (!colMap.has(col)) colMap.set(col, []);
      colMap.get(col)!.push(step);
    }

    // Sort columns
    const sortedCols = Array.from(colMap.keys()).sort((a, b) => a - b);

    const nodes: NodeLayout[] = [];

    let colX = PADDING;
    for (const colIdx of sortedCols) {
      const colSteps = colMap.get(colIdx)!;
      // Sort steps within column by id for deterministic layout
      colSteps.sort((a, b) => a.id.localeCompare(b.id));

      const totalColHeight =
        colSteps.length * NODE_HEIGHT + (colSteps.length - 1) * ROW_GAP;
      let rowY = PADDING;

      // We'll position from top; centering happens after we know max col height
      for (let i = 0; i < colSteps.length; i++) {
        const step = colSteps[i];
        const x = colX;
        const y = PADDING + i * (NODE_HEIGHT + ROW_GAP);
        nodes.push({
          step,
          x,
          y,
          cx: x + NODE_WIDTH / 2,
          cy: y + NODE_HEIGHT / 2,
        });
        rowY += NODE_HEIGHT + ROW_GAP;
      }

      void totalColHeight;
      colX += NODE_WIDTH + COL_GAP;
    }

    const svgWidth = colX - COL_GAP + PADDING;
    const maxY = Math.max(...nodes.map((n) => n.y + NODE_HEIGHT));
    const svgHeight = maxY + PADDING;

    return { nodes, svgWidth, svgHeight };
  }, [steps]);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export default function TaskDAGView({ steps, onStepClick }: Props) {
  const { nodes, svgWidth, svgHeight } = useLayout(steps);

  if (steps.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px",
          color: "var(--text-muted, #94a3b8)",
          fontSize: "14px",
        }}
      >
        No steps yet
      </div>
    );
  }

  // Build id -> node map for edge drawing
  const nodeById = new Map<string, NodeLayout>();
  for (const node of nodes) {
    nodeById.set(node.step.id, node);
  }

  // Collect edges: for each step, draw from its left edge to each dependency's right edge
  const edges: {
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
  }[] = [];

  for (const node of nodes) {
    for (const depId of node.step.depends_on) {
      const depNode = nodeById.get(depId);
      if (!depNode) continue;
      // Line from dep's right edge to node's left edge
      edges.push({
        key: `${depId}->${node.step.id}`,
        x1: depNode.x + NODE_WIDTH, // dep right edge
        y1: depNode.cy,
        x2: node.x, // node left edge
        y2: node.cy,
        color: STATUS_STROKE[node.step.status],
      });
    }
  }

  return (
    <div
      style={{
        overflowX: "auto",
        overflowY: "auto",
        width: "100%",
        background: "var(--surface-0, #0f172a)",
        borderRadius: "8px",
      }}
    >
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ display: "block", minWidth: svgWidth }}
        aria-label="Task dependency graph"
      >
        {/* Edges (drawn behind nodes) */}
        {edges.map((edge) => {
          const dx = (edge.x2 - edge.x1) * 0.5;
          const cp1x = edge.x1 + dx;
          const cp1y = edge.y1;
          const cp2x = edge.x2 - dx;
          const cp2y = edge.y2;
          return (
            <path
              key={edge.key}
              d={`M ${edge.x1} ${edge.y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${edge.x2} ${edge.y2}`}
              fill="none"
              stroke={edge.color}
              strokeWidth={1.5}
              strokeOpacity={0.7}
              markerEnd="url(#arrowhead)"
            />
          );
        })}

        {/* Arrowhead marker */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              fill="var(--border, #475569)"
              fillOpacity={0.8}
            />
          </marker>
        </defs>

        {/* Nodes */}
        {nodes.map((node) => {
          const { step, x, y } = node;
          const fill = STATUS_FILL[step.status];
          const stroke = STATUS_STROKE[step.status];
          const textColor = STATUS_TEXT[step.status];
          const isDashed = step.status === "pending_dependency";

          return (
            <g
              key={step.id}
              style={{ cursor: onStepClick ? "pointer" : "default" }}
              onClick={() => onStepClick?.(step)}
              role={onStepClick ? "button" : undefined}
              aria-label={`${step.title} (${step.status})`}
              tabIndex={onStepClick ? 0 : undefined}
              onKeyDown={
                onStepClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onStepClick(step);
                      }
                    }
                  : undefined
              }
            >
              <rect
                x={x}
                y={y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={6}
                ry={6}
                fill={fill}
                stroke={stroke}
                strokeWidth={isDashed ? 1.5 : 1}
                strokeDasharray={isDashed ? "4 3" : undefined}
              />
              {/* Title */}
              <text
                x={x + NODE_WIDTH / 2}
                y={y + 18}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={textColor}
                fontSize={11}
                fontWeight={600}
                fontFamily="inherit"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {truncate(step.title, 16)}
              </text>
              {/* Agent key */}
              <text
                x={x + NODE_WIDTH / 2}
                y={y + 34}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={textColor}
                fontSize={9}
                fontWeight={400}
                fontFamily="inherit"
                fillOpacity={0.7}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {truncate(step.agent_key, 18)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
