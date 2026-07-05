"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GraphData } from "@/lib/graph";
import type { GraphKind } from "@/lib/supabase/database.types";

// Dependency-free graph visualization. Nodes are laid out on a circle (radial)
// and edges drawn as straight SVG lines between them. No external SDKs — pure
// SVG + a tiny bit of trig, per AGENT.md's "no external SDKs for core" rule.
//
// Interactions, all client-side: hover lights a node's neighborhood; click opens
// a detail panel and lets you trace the shortest path between two nodes; search
// and type filters keep large graphs legible; edge weight reflects tie strength.

const TABS: { key: GraphKind; label: string; hint: string }[] = [
  { key: "relationship", label: "Relationship", hint: "Who knows whom, who invested in what" },
  { key: "deal", label: "Deal", hint: "Active deals, targets, SPVs, funds" },
  { key: "capital", label: "Capital", hint: "LPs, lenders, family offices, banks" },
];

const EMPTY_STATE: Record<GraphKind, {
  title: string;
  description: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
}> = {
  relationship: {
    title: "Start with your relationship graph.",
    description: "Import network contacts or connect inbox channels so FundExecs can map who knows whom before outreach starts.",
    primaryLabel: "Open Network",
    primaryHref: "/source/network",
    secondaryLabel: "Connect channels",
    secondaryHref: "/settings#integrations",
  },
  deal: {
    title: "Seed the deal graph.",
    description: "Add active opportunities to the deal pipeline so targets, funds, SPVs, documents, and IC work appear as a traceable graph.",
    primaryLabel: "Open Deal Pipeline",
    primaryHref: "/source/deal_pipeline",
    secondaryLabel: "Ask Earn",
    secondaryHref: "/workspace",
  },
  capital: {
    title: "Build the capital graph.",
    description: "Add LPs and commitments so allocators, lenders, capital events, and ownership paths become visible.",
    primaryLabel: "Open Capital Map",
    primaryHref: "/capital-map",
    secondaryLabel: "Open LP Pipeline",
    secondaryHref: "/source/lp_pipeline",
  },
};

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
  // Professional Network contacts imported through the professional-network
  // pipeline (network_contacts) — teal to stand apart from investors/principals.
  contact: "#2dd4bf",
};

function colorFor(type: string): string {
  return TYPE_COLOR[type] ?? "#8a8a8a";
}

const SIZE = 720;
const CENTER = SIZE / 2;

function layout(nodes: GraphData["nodes"]) {
  const n = nodes.length;
  const radius = Math.min(CENTER - 90, 60 + n * 8);
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.id, {
      x: CENTER + radius * Math.cos(angle),
      y: CENTER + radius * Math.sin(angle),
    });
  });
  return positions;
}

// Shortest path between two nodes over the undirected adjacency (BFS). Returns
// the node-id chain, or null when unreachable.
function shortestPath(from: string, to: string, neighbors: Map<string, Set<string>>): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const node = queue.shift()!;
    for (const next of neighbors.get(node) ?? []) {
      if (!prev.has(next)) {
        prev.set(next, node);
        if (next === to) {
          const chain: string[] = [];
          let cur: string | null = to;
          while (cur != null) {
            chain.unshift(cur);
            cur = prev.get(cur) ?? null;
          }
          return chain;
        }
        queue.push(next);
      }
    }
  }
  return null;
}

export function GraphExplorer({ graphs }: { graphs: Record<GraphKind, GraphData> }) {
  const [active, setActive] = useState<GraphKind>("relationship");
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [traceFrom, setTraceFrom] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  const fullData = graphs[active];
  const tab = TABS.find((t) => t.key === active)!;
  const presentTypes = useMemo(() => [...new Set(fullData.nodes.map((n) => n.type))], [fullData]);

  // Visible subgraph after type filtering — both nodes and any edge touching a
  // hidden node drop out.
  const data = useMemo(() => {
    if (!hiddenTypes.size) return fullData;
    const keep = new Set(fullData.nodes.filter((n) => !hiddenTypes.has(n.type)).map((n) => n.id));
    return {
      nodes: fullData.nodes.filter((n) => keep.has(n.id)),
      edges: fullData.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }, [fullData, hiddenTypes]);

  const positions = layout(data.nodes);
  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);

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

  // Trace path: active when a node is pinned as the source and a different node
  // is selected as the target.
  const tracePath = useMemo(() => {
    if (traceFrom && selected && traceFrom !== selected) {
      return shortestPath(traceFrom, selected, neighbors);
    }
    return null;
  }, [traceFrom, selected, neighbors]);
  const tracedSet = useMemo(() => (tracePath ? new Set(tracePath) : null), [tracePath]);
  const tracedEdge = (a: string, b: string) => {
    if (!tracePath) return false;
    for (let i = 0; i < tracePath.length - 1; i++) {
      if (
        (tracePath[i] === a && tracePath[i + 1] === b) ||
        (tracePath[i] === b && tracePath[i + 1] === a)
      )
        return true;
    }
    return false;
  };

  const q = query.trim().toLowerCase();
  const focus = hovered ?? selected;

  // Whether a node reads as lit, given the active context (trace > focus > search).
  function nodeLit(id: string): boolean {
    if (tracedSet) return tracedSet.has(id);
    if (focus) return id === focus || !!neighbors.get(focus)?.has(id);
    if (q) return (nodeById.get(id)?.label ?? "").toLowerCase().includes(q);
    return true;
  }

  const selectedNode = selected ? nodeById.get(selected) : null;

  function onNodeClick(id: string) {
    setSelected((cur) => (cur === id ? null : id));
  }
  function clearSelection() {
    setSelected(null);
    setTraceFrom(null);
  }

  return (
    <div>
      <div className="fx-segment mb-4 inline-flex">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setActive(t.key);
              setHovered(null);
              clearSelection();
              setHiddenTypes(new Set());
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

      {/* Controls: search + type filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
          className="min-w-[160px] flex-1 rounded-lg border border-line bg-surface-0 px-3 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
        />
        <span className="ml-auto font-mono text-[10px] text-fg-muted">
          {data.nodes.length} nodes · {data.edges.length} edges
        </span>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {presentTypes.map((t) => {
          const off = hiddenTypes.has(t);
          return (
            <button
              key={t}
              onClick={() =>
                setHiddenTypes((prev) => {
                  const next = new Set(prev);
                  if (next.has(t)) next.delete(t);
                  else next.add(t);
                  return next;
                })
              }
              className={`flex items-center gap-1.5 transition ${off ? "opacity-35" : ""}`}
              title={off ? "Show" : "Hide"}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colorFor(t), boxShadow: off ? "none" : `0 0 8px ${colorFor(t)}66` }}
              />
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                {t.replace(/_/g, " ")}
              </span>
            </button>
          );
        })}
      </div>

      {data.nodes.length === 0 ? (
        <div className="fx-card relative mt-6 overflow-hidden p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgb(var(--fx-accent-rgb)/0.16),transparent_34%)]" />
          <div className="relative grid gap-5 md:grid-cols-[1fr_220px] md:items-center">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
                {tab.label} graph activation
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg-primary">
                {EMPTY_STATE[active].title}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-secondary">
                {EMPTY_STATE[active].description}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={EMPTY_STATE[active].primaryHref} className="fx-btn-primary">
                  {EMPTY_STATE[active].primaryLabel}
                </Link>
                <Link href={EMPTY_STATE[active].secondaryHref} className="fx-btn-secondary">
                  {EMPTY_STATE[active].secondaryLabel}
                </Link>
              </div>
            </div>
            <div className="rounded-2xl border border-line/70 bg-surface-0/60 p-4">
              {TABS.map((t) => (
                <div key={t.key} className="flex items-center gap-3 border-b border-line/50 py-2 last:border-b-0">
                  <span className={`h-2.5 w-2.5 rounded-full ${active === t.key ? "bg-gold-400" : "bg-fg-muted/40"}`} />
                  <div>
                    <p className="text-sm font-medium text-fg-primary">{t.label}</p>
                    <p className="text-xs text-fg-muted">{t.hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="fx-card relative mt-4 overflow-hidden">
          {/* Detail panel for the selected node. */}
          {selectedNode ? (
            <div className="absolute right-3 top-3 z-10 w-60 rounded-xl border border-line bg-surface-1/95 p-3 shadow-xl shadow-black/40 backdrop-blur">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorFor(selectedNode.type) }} />
                    <p className="truncate text-sm font-medium text-fg-primary">{selectedNode.label || "—"}</p>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {selectedNode.type.replace(/_/g, " ")} · {neighbors.get(selectedNode.id)?.size ?? 0} ties
                  </p>
                </div>
                <button onClick={clearSelection} className="text-fg-muted transition hover:text-fg-primary" aria-label="Close">
                  ✕
                </button>
              </div>

              {tracePath ? (
                <div className="mt-2 rounded-lg border border-gold-500/30 bg-gold-500/[0.06] px-2 py-1.5">
                  <p className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
                    Path · {tracePath.length - 1} hop{tracePath.length - 1 === 1 ? "" : "s"}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-secondary">
                    {tracePath.map((id) => nodeById.get(id)?.label || "—").join(" → ")}
                  </p>
                </div>
              ) : traceFrom === selectedNode.id ? (
                <p className="mt-2 text-xs text-fg-muted">Pinned as source — click another node to trace a path.</p>
              ) : traceFrom ? (
                <p className="mt-2 text-xs text-status-danger">No path from the pinned source.</p>
              ) : null}

              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() => setTraceFrom(selectedNode.id)}
                  className="flex-1 rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-fg-primary"
                >
                  Trace from here
                </button>
                {traceFrom ? (
                  <button
                    onClick={() => setTraceFrom(null)}
                    className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-auto w-full" role="img" aria-label={`${tab.label} graph`}>
            <defs>
              <radialGradient id="fx-graph-bg" cx="50%" cy="42%" r="65%">
                <stop offset="0%" stopColor="#1C1A16" />
                <stop offset="100%" stopColor="#0B0A08" />
              </radialGradient>
              <filter id="fx-node-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <rect x="0" y="0" width={SIZE} height={SIZE} fill="url(#fx-graph-bg)" />

            {data.edges.map((e, i) => {
              const a = positions.get(e.source);
              const b = positions.get(e.target);
              if (!a || !b) return null;
              const onTrace = tracedEdge(e.source, e.target);
              const lit = tracedSet
                ? onTrace
                : focus
                  ? e.source === focus || e.target === focus
                  : q
                    ? nodeLit(e.source) || nodeLit(e.target)
                    : true;
              // Tie strength → stroke weight (relationship graph); structural
              // edges fall back to a hairline.
              const baseWidth = e.strength != null ? 0.75 + (Math.min(100, e.strength) / 100) * 2 : 1;
              const highlight = onTrace || (!!focus && lit);
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={highlight ? "#D4AF6A" : "#4a4a4a"}
                  strokeWidth={highlight ? baseWidth + 0.75 : baseWidth}
                  strokeOpacity={lit ? (highlight ? 0.85 : 0.45) : 0.07}
                  style={{ transition: "stroke 0.2s, stroke-opacity 0.2s" }}
                />
              );
            })}

            {data.nodes.map((node) => {
              const p = positions.get(node.id)!;
              const onRight = p.x >= CENTER;
              const lit = nodeLit(node.id);
              const focused = focus === node.id || selected === node.id;
              const pinned = traceFrom === node.id || (tracedSet?.has(node.id) ?? false);
              return (
                <g
                  key={node.id}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onNodeClick(node.id)}
                  style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                  opacity={lit ? 1 : 0.22}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={focused ? 9 : pinned ? 8 : 6}
                    fill={colorFor(node.type)}
                    stroke={focused || pinned ? "#F5F1E8" : "#1a1a1a"}
                    strokeWidth={focused || pinned ? 2 : 1.5}
                    filter={focused || pinned ? "url(#fx-node-glow)" : undefined}
                    style={{ transition: "r 0.15s ease" }}
                  />
                  <text
                    x={p.x + (onRight ? 12 : -12)}
                    y={p.y + 3.5}
                    textAnchor={onRight ? "start" : "end"}
                    className={focused ? "fill-fg-primary" : "fill-fg-secondary"}
                    style={{ fontSize: focused ? 11 : 10, fontWeight: focused ? 600 : 400 }}
                  >
                    {(node.label ?? "").length > 28 ? `${(node.label ?? "").slice(0, 27)}…` : (node.label ?? "")}
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
