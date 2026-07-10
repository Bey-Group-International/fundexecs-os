"use client";

// Live Team-Flow Visualizer — a real-time node graph of the delegation chain.
//
// When a workflow is live, it draws Earn (the command operator) at the root and
// an edge to each executive Earn routed the work to, labelled with the
// deliverable they own; edges to executives who are actively working animate.
// When the floor is idle, it shows Earn wired to the full team it can delegate
// to (the org at rest). Synced to activeWorkflow + the live agent runtime, this
// is "The Delegation"'s team-flow view adapted to the native program model.
//
// Rendered as lightweight SVG (no graph dependency) inside the shared
// FloorOverlay, so it themes and behaves like the other in-world overlays.
import { FloorOverlay } from "./FloorOverlay";
import { useOfficeProgram } from "./useOfficeProgram";
import {
  AGENT_BY_ID,
  PROGRAM_AGENTS,
  type AgentId,
  type AgentState,
} from "./officeProgram";

const GOLD = "#c9a84c";
const W = 680;
const ROOT_Y = 46;
const ROW_Y0 = 150;
const ROW_GAP = 128;
const PER_ROW = 5;

const STATE_LABEL: Record<AgentState, string> = {
  idle: "Idle",
  listening: "Listening",
  classifying: "Analyzing",
  assigned: "Assigned",
  moving: "Moving",
  working: "Working",
  collaborating: "Collaborating",
  reviewing: "Reviewing",
  waiting_for_approval: "Awaiting approval",
  complete: "Complete",
  blocked: "Blocked",
};

const STATE_COLOR: Record<AgentState, string> = {
  idle: "#64748b",
  listening: "#fbbf24",
  classifying: "#fbbf24",
  assigned: "#c9a84c",
  moving: "#c9a84c",
  working: "#38bdf8",
  collaborating: "#38bdf8",
  reviewing: "#a855f7",
  waiting_for_approval: "#f59e0b",
  complete: "#22c55e",
  blocked: "#ef4444",
};

// Edges pulse while the executive is actively executing.
const ACTIVE_STATES = new Set<AgentState>(["moving", "working", "collaborating", "reviewing"]);

type FlowNode = {
  id: AgentId;
  name: string;
  accent: string;
  state: AgentState;
  owns: string | null;
  progress: number;
  dim: boolean;
  x: number;
  y: number;
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function TeamFlowGraph({ onClose }: { onClose: () => void }) {
  const s = useOfficeProgram();
  const active = s.activeWorkflow;

  // Executive set: the assigned chain when live, else the full team (idle org).
  const execIds: AgentId[] = active
    ? active.assignments.map((a) => a.agentId)
    : PROGRAM_AGENTS.filter((a) => a.id !== "earn").map((a) => a.id);

  const rows = Math.max(1, Math.ceil(execIds.length / PER_ROW));
  const height = ROW_Y0 + (rows - 1) * ROW_GAP + 78;

  const nodes: FlowNode[] = execIds.map((id, i) => {
    const rt = s.agents[id];
    const assignment = active?.assignments.find((a) => a.agentId === id) ?? null;
    const row = Math.floor(i / PER_ROW);
    const inRow = execIds.slice(row * PER_ROW, row * PER_ROW + PER_ROW);
    const idxInRow = i - row * PER_ROW;
    const x = (W * (idxInRow + 1)) / (inRow.length + 1);
    const y = ROW_Y0 + row * ROW_GAP;
    return {
      id,
      name: AGENT_BY_ID[id]?.name ?? id,
      accent: AGENT_BY_ID[id]?.accent ?? GOLD,
      state: rt?.state ?? "idle",
      owns: assignment?.owns ?? rt?.owns ?? null,
      progress: assignment?.progress ?? rt?.progress ?? 0,
      dim: !active,
      x,
      y,
    };
  });

  const rootX = W / 2;

  return (
    <FloorOverlay
      accent={GOLD}
      onClose={onClose}
      ariaLabel="Team-flow graph"
      maxWidth={720}
      eyebrow="Team flow"
      title={active ? "Live delegation" : "Delegation graph"}
      subtitle={active ? truncate(active.title, 64) : "Team idle — Earn routes the next task here"}
    >
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: "block" }} role="img" aria-label="Delegation flow graph">
        <style>{`
          @keyframes tf-dash { to { stroke-dashoffset: -16; } }
          .tf-edge-active { stroke-dasharray: 5 4; animation: tf-dash 0.8s linear infinite; }
        `}</style>

        {/* Edges: Earn → each executive */}
        {nodes.map((n) => {
          const activeEdge = active && ACTIVE_STATES.has(n.state);
          const midY = (ROOT_Y + n.y) / 2;
          return (
            <path
              key={`edge-${n.id}`}
              d={`M ${rootX} ${ROOT_Y + 22} C ${rootX} ${midY}, ${n.x} ${midY}, ${n.x} ${n.y - 26}`}
              fill="none"
              stroke={activeEdge ? n.accent : `${n.accent}${n.dim ? "22" : "55"}`}
              strokeWidth={activeEdge ? 2 : 1.25}
              className={activeEdge ? "tf-edge-active" : undefined}
            />
          );
        })}

        {/* Root — Earn */}
        <g>
          <circle cx={rootX} cy={ROOT_Y} r={22} fill={`${GOLD}1a`} stroke={GOLD} strokeWidth={1.75} />
          <text x={rootX} y={ROOT_Y + 4} textAnchor="middle" fontFamily="Georgia, serif" fontSize={11} fill="#f4f0e8">
            Earn
          </text>
          <text x={rootX} y={ROOT_Y + 38} textAnchor="middle" fontFamily="monospace" fontSize={8} fill="rgba(255,248,220,0.4)" letterSpacing="0.08em">
            COMMAND
          </text>
        </g>

        {/* Executive nodes */}
        {nodes.map((n) => {
          const sc = STATE_COLOR[n.state];
          const nodeOpacity = n.dim ? 0.5 : 1;
          return (
            <g key={`node-${n.id}`} opacity={nodeOpacity}>
              <rect x={n.x - 58} y={n.y - 26} width={116} height={52} rx={7} fill="rgba(12,10,7,0.95)" stroke={`${n.accent}88`} strokeWidth={1.25} />
              {/* status dot */}
              <circle cx={n.x - 46} cy={n.y - 13} r={4} fill={sc} />
              <text x={n.x - 38} y={n.y - 9} fontFamily="Georgia, serif" fontSize={10.5} fill="rgba(255,248,220,0.92)">
                {truncate(n.name, 14)}
              </text>
              <text x={n.x - 46} y={n.y + 6} fontFamily="monospace" fontSize={8} fill={sc} letterSpacing="0.04em">
                {STATE_LABEL[n.state]}
              </text>
              {/* progress bar (only when there's a live deliverable) */}
              {n.owns != null && (
                <>
                  <rect x={n.x - 46} y={n.y + 12} width={92} height={3} rx={1.5} fill="rgba(255,255,255,0.08)" />
                  <rect x={n.x - 46} y={n.y + 12} width={(92 * n.progress) / 100} height={3} rx={1.5} fill={n.state === "complete" ? "#22c55e" : n.accent} />
                </>
              )}
              {/* deliverable label under the node */}
              {active && n.owns != null && (
                <text x={n.x} y={n.y + 40} textAnchor="middle" fontFamily="monospace" fontSize={8} fill="rgba(255,248,220,0.5)">
                  {truncate(n.owns, 22)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {!active && (
        <div style={{ marginTop: 8, textAlign: "center", fontSize: 10, color: "rgba(255,248,220,0.4)", fontFamily: "monospace" }}>
          Delegate a task (walk up to an executive, or ⌘K) to light up the chain.
        </div>
      )}
    </FloorOverlay>
  );
}
