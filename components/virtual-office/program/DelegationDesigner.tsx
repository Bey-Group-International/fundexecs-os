"use client";

// Delegation Designer — a no-code editor for the AI executive team.
//
// The floor's delegation graph (Earn → executives) is here made editable: pick
// an executive node and set whether Earn may delegate to it, its preferred model
// provider, and whether its outputs pass through a human-in-the-loop approval
// gate (and at which risk tier). Edits live in a sandbox draft; "Apply" commits
// them to the team config (lib/office/teamConfig.ts), which the floor's roster
// and inspector then reflect. This is "The Delegation"'s no-code agent designer
// adapted to the native team model, with the Design + Apply flow.
import { useMemo, useState } from "react";
import { FloorOverlay } from "./FloorOverlay";
import { AGENT_BY_ID, PROGRAM_AGENTS, RISK_TIERS, type AgentId, type RiskTier } from "./officeProgram";
import { executiveSheet, SKILL_LABELS } from "@/lib/office/characterSheet";
import {
  PROVIDER_LABELS,
  TEAM_PROVIDERS,
  loadTeamConfig,
  resolveExecConfig,
  saveTeamConfig,
  type ExecConfig,
  type TeamConfig,
  type TeamProvider,
} from "@/lib/office/teamConfig";

const GOLD = "#c9a84c";
const W = 680;

// The delegable executives (Earn is the fixed command root, not editable).
const EXECS: AgentId[] = PROGRAM_AGENTS.filter((a) => a.id !== "earn").map((a) => a.id);
const PER_ROW = 5;

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: `1px solid ${GOLD}33`,
  borderRadius: 4,
  color: "rgba(255,248,220,0.9)",
  fontSize: 11,
  padding: "4px 6px",
  fontFamily: "monospace",
};

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: on ? `${GOLD}1e` : "rgba(255,255,255,0.04)",
        border: `1px solid ${on ? `${GOLD}66` : "rgba(255,255,255,0.1)"}`,
        borderRadius: 999,
        padding: "3px 9px",
        cursor: "pointer",
        color: on ? GOLD : "rgba(255,248,220,0.55)",
        fontSize: 10,
        fontFamily: "Georgia,serif",
        letterSpacing: "0.04em",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? GOLD : "rgba(255,255,255,0.2)" }} />
      {label}
    </button>
  );
}

export function DelegationDesigner({ onClose }: { onClose: () => void }) {
  const initial = useMemo(() => loadTeamConfig(), []);
  const [saved, setSaved] = useState<TeamConfig>(initial);
  const [draft, setDraft] = useState<TeamConfig>(initial);
  const [selected, setSelected] = useState<AgentId>(EXECS[0]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const cfgOf = (id: AgentId): ExecConfig => resolveExecConfig(id, draft);
  const patch = (id: AgentId, p: Partial<ExecConfig>) =>
    setDraft((d) => ({ ...d, [id]: { ...resolveExecConfig(id, d), ...p } }));

  const apply = () => {
    saveTeamConfig(draft);
    setSaved(draft);
  };

  const sel = cfgOf(selected);
  const selMeta = AGENT_BY_ID[selected];
  const selSheet = executiveSheet(selMeta);

  // Node layout (Earn root → exec grid), reused from the flow graph in spirit.
  const rows = Math.ceil(EXECS.length / PER_ROW);
  const rootY = 40;
  const rowY0 = 120;
  const rowGap = 92;
  const height = rowY0 + (rows - 1) * rowGap + 44;
  const rootX = W / 2;

  const nodePos = (i: number) => {
    const row = Math.floor(i / PER_ROW);
    const inRow = EXECS.slice(row * PER_ROW, row * PER_ROW + PER_ROW);
    const idx = i - row * PER_ROW;
    return { x: (W * (idx + 1)) / (inRow.length + 1), y: rowY0 + row * rowGap };
  };

  return (
    <FloorOverlay
      accent={GOLD}
      onClose={onClose}
      ariaLabel="Delegation designer"
      maxWidth={720}
      eyebrow="Delegation designer"
      title="Design the executive team"
      subtitle="Compose who Earn delegates to · edits stay a draft until you Apply"
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: dirty ? GOLD : "rgba(255,248,220,0.4)", fontFamily: "monospace" }}>
            {dirty ? "Unsaved changes" : "No changes"}
          </span>
          <button
            type="button"
            onClick={() => setDraft({})}
            style={{ marginLeft: "auto", ...inputStyle, cursor: "pointer", fontFamily: "Georgia,serif" }}
          >
            Restore defaults
          </button>
          <button
            type="button"
            onClick={() => setDraft(saved)}
            disabled={!dirty}
            style={{ ...inputStyle, cursor: dirty ? "pointer" : "not-allowed", opacity: dirty ? 1 : 0.4, fontFamily: "Georgia,serif" }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!dirty}
            style={{
              borderRadius: 4,
              padding: "5px 14px",
              fontFamily: "Georgia,serif",
              fontSize: 11,
              letterSpacing: "0.06em",
              cursor: dirty ? "pointer" : "not-allowed",
              opacity: dirty ? 1 : 0.5,
              color: "#0a0806",
              background: GOLD,
              border: `1px solid ${GOLD}`,
            }}
          >
            Apply to floor
          </button>
        </div>
      }
    >
      {/* Editable delegation graph — click a node to edit it. */}
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: "block" }} role="img" aria-label="Team graph">
        {EXECS.map((id, i) => {
          const p = nodePos(i);
          const c = cfgOf(id);
          const accent = AGENT_BY_ID[id]?.accent ?? GOLD;
          const midY = (rootY + p.y) / 2;
          return (
            <path
              key={`e-${id}`}
              d={`M ${rootX} ${rootY + 18} C ${rootX} ${midY}, ${p.x} ${midY}, ${p.x} ${p.y - 18}`}
              fill="none"
              stroke={c.enabled ? `${accent}66` : "rgba(255,255,255,0.08)"}
              strokeWidth={1.25}
              strokeDasharray={c.enabled ? undefined : "3 3"}
            />
          );
        })}

        {/* Earn root */}
        <circle cx={rootX} cy={rootY} r={18} fill={`${GOLD}1a`} stroke={GOLD} strokeWidth={1.75} />
        <text x={rootX} y={rootY + 4} textAnchor="middle" fontFamily="Georgia, serif" fontSize={10} fill="#f4f0e8">Earn</text>

        {EXECS.map((id, i) => {
          const p = nodePos(i);
          const c = cfgOf(id);
          const accent = AGENT_BY_ID[id]?.accent ?? GOLD;
          const isSel = id === selected;
          return (
            <g key={`n-${id}`} onClick={() => setSelected(id)} style={{ cursor: "pointer" }} opacity={c.enabled ? 1 : 0.4}>
              <circle cx={p.x} cy={p.y} r={15} fill="rgba(12,10,7,0.95)" stroke={isSel ? GOLD : `${accent}88`} strokeWidth={isSel ? 2.5 : 1.25} />
              {c.humanInLoop && <circle cx={p.x + 12} cy={p.y - 12} r={3.5} fill="#f59e0b" />}
              <text x={p.x} y={p.y + 30} textAnchor="middle" fontFamily="monospace" fontSize={8} fill={isSel ? GOLD : "rgba(255,248,220,0.6)"}>
                {(AGENT_BY_ID[id]?.name ?? id).split(" ")[0]}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Editor for the selected executive */}
      <div style={{ borderTop: `1px solid ${GOLD}22`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: selMeta?.accent ?? GOLD }} />
          <span style={{ fontFamily: "Georgia,serif", fontSize: 13, color: "rgba(255,248,220,0.92)" }}>{selMeta?.name}</span>
          <span style={{ fontSize: 9, color: "rgba(255,248,220,0.45)" }}>{selMeta?.role}</span>
        </div>

        {/* Skills (read-only, for context) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {selSheet.skills.map((sk) => (
            <span key={sk} style={{ fontSize: 9, color: "rgba(255,248,220,0.6)", background: "rgba(255,255,255,0.04)", border: `1px solid ${GOLD}2e`, borderRadius: 3, padding: "1px 6px" }}>
              {SKILL_LABELS[sk]}
            </span>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: `${GOLD}aa`, fontFamily: "Georgia,serif" }}>Model provider</span>
            <select
              value={sel.provider}
              onChange={(e) => patch(selected, { provider: e.target.value as TeamProvider })}
              style={inputStyle}
            >
              {TEAM_PROVIDERS.map((p) => (
                <option key={p} value={p} style={{ background: "#0a0806" }}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: `${GOLD}aa`, fontFamily: "Georgia,serif" }}>Gate tier</span>
            <select
              value={sel.gateTier}
              onChange={(e) => patch(selected, { gateTier: e.target.value as RiskTier })}
              disabled={!sel.humanInLoop}
              style={{ ...inputStyle, opacity: sel.humanInLoop ? 1 : 0.45 }}
            >
              {(Object.keys(RISK_TIERS) as RiskTier[]).map((t) => (
                <option key={t} value={t} style={{ background: "#0a0806" }}>{RISK_TIERS[t].label}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Toggle on={sel.enabled} label={sel.enabled ? "On the team" : "Off the team"} onClick={() => patch(selected, { enabled: !sel.enabled })} />
          <Toggle on={sel.humanInLoop} label="Human-in-the-loop" onClick={() => patch(selected, { humanInLoop: !sel.humanInLoop })} />
        </div>
        <p style={{ fontSize: 9, color: "rgba(255,248,220,0.4)", lineHeight: 1.5, fontFamily: "monospace" }}>
          {sel.enabled
            ? `Earn may delegate to ${selMeta?.name}.`
            : `Earn will not route work to ${selMeta?.name}.`}
          {sel.humanInLoop
            ? ` Outputs at ${RISK_TIERS[sel.gateTier].short}+ require your approval.`
            : ""}
        </p>
      </div>
    </FloorOverlay>
  );
}
