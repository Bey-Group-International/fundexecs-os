"use client";

import { useMemo, useState } from "react";
import type { GraphData } from "@/lib/graph";
import type { GraphKind } from "@/lib/supabase/database.types";

// Dependency-free graph visualization. Nodes are laid out on a circle (radial)
// and edges drawn as straight SVG lines between them. No external SDKs — pure
// SVG + a tiny bit of trig, per AGENT.md's "no external SDKs for core" rule.
// Hovering a node highlights its immediate neighborhood and dims the rest.

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
  const [hovered, setHovered] = useState<string | null>(null);
  const data = graphs[active];
  const positions = layout(data);
  const tab = TABS.find((t) => t.key === active)!;

  // Adjacency for the hover highlight: the hovered node plus everything one hop
  // away stays lit; the rest dims back.
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of data.edges) {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    }
    return map;
  }, [data]);

  const isLit = (id: string) =>
    !hovered || id === hovered || neighbors.get(hovered)?.has(id);

  // Distinct legend entries for the types actually present.
  const presentTypes = [...new Set(data.nodes.map((n) => n.type))];

  return (
    <div>
      <div className="fx-segment mb-4 inline-flex">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setActive(t.key);
              setHovered(null);
            }}
            className={`rounded-md px-4 py-1.5 text-sm transition ${
              active === t.key
                ? "bg-gold-400 font-medium text-surface-0 shadow-[0_4px_14px_-6px_rgba(212,175,106,0.7)]"
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
              style={{ backgroundColor: colorFor(t), boxShadow: `0 0 8px ${colorFor(t)}66` }}
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
        <div className="fx-card mt-6 p-10 text-center">
          <p className="text-sm text-fg-muted">
            No {tab.label.toLowerCase()} graph data yet. As deals, funds,
            investors and relationships accrue, they appear here.
          </p>
        </div>
      ) : (
        <div className="fx-card mt-4 overflow-hidden">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="h-auto w-full"
            role="img"
            aria-label={`${tab.label} graph`}
          >
            <defs>
              {/* Soft vignette so the radial layout sits in a lit well. */}
              <radialGradient id="fx-graph-bg" cx="50%" cy="42%" r="65%">
                <stop offset="0%" stopColor="#1C1A16" />
                <stop offset="100%" stopColor="#0B0A08" />
              </radialGradient>
              {/* Gentle glow used on the focused node. */}
              <filter id="fx-node-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <rect x="0" y="0" width={SIZE} height={SIZE} fill="url(#fx-graph-bg)" />

            {/* Edges first so nodes render on top. */}
            {data.edges.map((e, i) => {
              const a = positions.get(e.source);
              const b = positions.get(e.target);
              if (!a || !b) return null;
              const lit = !hovered || e.source === hovered || e.target === hovered;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={lit && hovered ? "#D4AF6A" : "#4a4a4a"}
                  strokeWidth={lit && hovered ? 1.5 : 1}
                  strokeOpacity={hovered ? (lit ? 0.7 : 0.08) : 0.45}
                  style={{ transition: "stroke 0.2s, stroke-opacity 0.2s" }}
                />
              );
            })}
            {data.nodes.map((node) => {
              const p = positions.get(node.id)!;
              const onRight = p.x >= CENTER;
              const lit = isLit(node.id);
              const focused = hovered === node.id;
              return (
                <g
                  key={node.id}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                  opacity={lit ? 1 : 0.25}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={focused ? 9 : 6}
                    fill={colorFor(node.type)}
                    stroke={focused ? "#F5F1E8" : "#1a1a1a"}
                    strokeWidth={focused ? 2 : 1.5}
                    filter={focused ? "url(#fx-node-glow)" : undefined}
                    style={{ transition: "r 0.15s ease" }}
                  />
                  <text
                    x={p.x + (onRight ? 12 : -12)}
                    y={p.y + 3.5}
                    textAnchor={onRight ? "start" : "end"}
                    className={focused ? "fill-fg-primary" : "fill-fg-secondary"}
                    style={{ fontSize: focused ? 11 : 10, fontWeight: focused ? 600 : 400 }}
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
