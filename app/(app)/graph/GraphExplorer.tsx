"use client";

import { useState } from "react";
import type { GraphData } from "@/lib/graph";
import type { GraphKind } from "@/lib/supabase/database.types";

// Dependency-free graph visualization. Nodes are laid out on a circle (radial)
// and edges drawn as straight SVG lines between them. No external SDKs — pure
// SVG + a tiny bit of trig, per AGENT.md's "no external SDKs for core" rule.

const TABS: { key: GraphKind; label: string; hint: string }[] = [
  { key: "relationship", label: "Relationship", hint: "Who knows whom, who invested in what" },
  { key: "deal", label: "Deal", hint: "Active deals, targets, SPVs, funds" },
  { key: "capital", label: "Capital", hint: "LPs, lenders, family offices, banks" },
];

// Node category -> color. Falls back to a neutral tone for unknown types.
const TYPE_COLOR: Record<string, string> = {
  fund: "#d4a843",
  deal: "#5b9bd5",
  asset: "#67c587",
  investor: "#c77dff",
  lp: "#c77dff",
  family_office: "#e07a5f",
  institution: "#5b9bd5",
  fund_of_funds: "#9b8cff",
  lender: "#e8a33d",
  bank: "#e8a33d",
  co_gp: "#67c587",
  principal: "#f2c14e",
  organization: "#7a8aff",
};

function colorFor(type: string): string {
  return TYPE_COLOR[type] ?? "#8a8a8a";
}

const SIZE = 720;
const CENTER = SIZE / 2;

function layout(data: GraphData) {
  const n = data.nodes.length;
  // Keep nodes off the very edge so labels have room.
  const radius = Math.min(CENTER - 90, 60 + n * 8);
  const positions = new Map<string, { x: number; y: number }>();
  data.nodes.forEach((node, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.id, {
      x: CENTER + radius * Math.cos(angle),
      y: CENTER + radius * Math.sin(angle),
    });
  });
  return positions;
}

export function GraphExplorer({
  graphs,
}: {
  graphs: Record<GraphKind, GraphData>;
}) {
  const [active, setActive] = useState<GraphKind>("relationship");
  const data = graphs[active];
  const positions = layout(data);
  const tab = TABS.find((t) => t.key === active)!;

  // Distinct legend entries for the types actually present.
  const presentTypes = [...new Set(data.nodes.map((n) => n.type))];

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface-1 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`rounded-md px-4 py-1.5 text-sm transition ${
              active === t.key
                ? "bg-gold-400 font-medium text-surface-0"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="mb-4 text-sm text-fg-secondary">{tab.hint}.</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {presentTypes.map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: colorFor(t) }}
            />
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              {t.replace(/_/g, " ")}
            </span>
          </span>
        ))}
        <span className="ml-auto font-mono text-[10px] text-fg-muted">
          {data.nodes.length} nodes · {data.edges.length} edges
        </span>
      </div>

      {data.nodes.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-surface-1 p-10 text-center">
          <p className="text-sm text-fg-muted">
            No {tab.label.toLowerCase()} graph data yet. As deals, funds,
            investors and relationships accrue, they appear here.
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface-1">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="h-auto w-full"
            role="img"
            aria-label={`${tab.label} graph`}
          >
            {/* Edges first so nodes render on top. */}
            {data.edges.map((e, i) => {
              const a = positions.get(e.source);
              const b = positions.get(e.target);
              if (!a || !b) return null;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#4a4a4a"
                  strokeWidth={1}
                  strokeOpacity={0.5}
                />
              );
            })}
            {data.nodes.map((node) => {
              const p = positions.get(node.id)!;
              const onRight = p.x >= CENTER;
              return (
                <g key={node.id}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={6}
                    fill={colorFor(node.type)}
                    stroke="#1a1a1a"
                    strokeWidth={1.5}
                  />
                  <text
                    x={p.x + (onRight ? 10 : -10)}
                    y={p.y + 3.5}
                    textAnchor={onRight ? "start" : "end"}
                    className="fill-fg-secondary"
                    style={{ fontSize: 10 }}
                  >
                    {node.label.length > 28
                      ? `${node.label.slice(0, 27)}…`
                      : node.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
