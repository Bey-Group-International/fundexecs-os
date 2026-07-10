"use client";

import { useMemo, useState } from "react";
import { RichText } from "@/components/RichText";
import { text } from "@/lib/richtext";
import { AGENT_BY_ID, roomLabel, type AgentId, type AgentState, type AuditEvent } from "./officeProgram";
import { useOfficeProgram } from "./useOfficeProgram";
import {
  interactWithAgent,
  requestAgentReview,
  reassignAgentTask,
  reassignmentTargets,
  getExecPrecedents,
} from "./officeProgramStore";
import { relativeTime } from "@/lib/office/floor-activity";
import {
  executiveSheet,
  deriveTraits,
  traitDescriptor,
  reputationFromShipped,
  SKILL_LABELS,
  TRAIT_KEYS,
  TRAIT_LABELS,
} from "@/lib/office/characterSheet";

const GOLD = "#c9a84c";

// Shared section eyebrow (matches the inline style used across the panel).
const EYEBROW: React.CSSProperties = {
  fontSize: 8,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: `${GOLD}aa`,
  fontFamily: "Georgia,serif",
};

// Dot color per audit status, for the recent-activity trail.
const AUDIT_STATUS_COLOR: Record<AuditEvent["status"], string> = {
  info: "#94a3b8",
  pending: "#f59e0b",
  approved: "#c9a84c",
  rejected: "#ef4444",
  complete: "#22c55e",
};

const STATE_META: Record<AgentState, { label: string; color: string }> = {
  idle:                 { label: "Idle",              color: "#94a3b8" },
  listening:            { label: "Listening",         color: "#fbbf24" },
  classifying:          { label: "Analyzing",         color: "#fbbf24" },
  assigned:             { label: "Assigned",          color: "#c9a84c" },
  moving:               { label: "Moving",            color: "#c9a84c" },
  working:              { label: "Working",           color: "#38bdf8" },
  collaborating:        { label: "Collaborating",     color: "#38bdf8" },
  reviewing:            { label: "Reviewing",         color: "#a855f7" },
  waiting_for_approval: { label: "Awaiting approval", color: "#f59e0b" },
  complete:             { label: "Complete",          color: "#22c55e" },
  blocked:              { label: "Blocked",           color: "#ef4444" },
};

/** One-line rationale for why the office routes work to this executive. */
const WHY: Record<AgentId, string> = {
  earn:               "Command operator — classifies every instruction and delegates it across the floor.",
  associate:          "First-pass deal execution — screening, data-room build, and pipeline work.",
  principal:          "Strategic review and IC judgment; the deals desk escalates decisions here.",
  analyst:            "Underwriting and research — models, scenarios, and assumption validation.",
  risk:               "Controls & compliance — gates external-facing and capital-binding actions.",
  legal:              "Documents & transactions — NDAs, subscription docs, and closing papers.",
  investor_relations: "LP communications — updates, positioning, and investor comms.",
  treasury:           "Capital movement & settlement — calls, wires, and closing mechanics.",
  portfolio_ops:      "Post-close execution — KPIs and operating plans across the portfolio.",
  ops_admin:          "Fund administration — reporting and the compliance calendar.",
  business_dev:       "Sourcing & partnerships — the pipeline and relationship map.",
};

export function AgentFloorInspector({
  agentId,
  onAskEarn,
  onClose,
}: {
  agentId: AgentId;
  onAskEarn: () => void;
  onClose: () => void;
}) {
  const s = useOfficeProgram();
  const [picking, setPicking] = useState(false);
  const rt = s.agents[agentId];
  const meta = AGENT_BY_ID[agentId];
  // The executive's name as an Adventure-style rich-text sheen (accent → cream).
  // Computed before any early return so the hook order stays stable.
  const nameComponent = useMemo(
    () => text(meta?.name ?? "").gradient([meta?.accent ?? "#c9a84c", "#f4f0e8"]).bold().build(),
    [meta?.name, meta?.accent],
  );

  // Recent activity: this executive's own audit entries, newest-first.
  const recentActivity = useMemo(
    () => s.audit.filter((e) => e.actor === (meta?.name ?? "")).slice(-5).reverse(),
    [s.audit, meta?.name],
  );
  // Current thinking: the executive's most recent spoken line on the floor.
  const lastThought = useMemo(() => {
    const mine = s.chat.filter((c) => c.author === (meta?.name ?? ""));
    return mine.length ? mine[mine.length - 1] : null;
  }, [s.chat, meta?.name]);

  if (!rt || !meta) return null;

  const now = Date.now();
  // Memory (#62): the executive's shipped precedents — a live projection of the
  // audit trail (recomputed each render; the audit log is bounded). Newest-first.
  const precedents = getExecPrecedents(agentId).slice(0, 3);

  const sm = STATE_META[rt.state] ?? STATE_META.idle;
  const hasOwns = !!rt.owns;
  const targets = hasOwns ? reassignmentTargets(agentId) : [];

  // Competency layer (declarative character sheet). Reputation is a live,
  // read-only reflection of the audit trail: how many outputs this executive
  // has shipped ("complete" events under their name), mapped to a standing.
  const sheet = executiveSheet(meta);
  const traits = deriveTraits(sheet.attributes);
  const shipped = s.audit.filter((e) => e.actor === meta.name && e.status === "complete").length;
  const rep = reputationFromShipped(shipped);

  const panel: React.CSSProperties = {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 30,
    width: 264,
    maxHeight: "calc(100% - 24px)",
    overflowY: "auto",
    background: "linear-gradient(180deg, rgba(12,10,7,0.94) 0%, rgba(8,6,4,0.96) 100%)",
    backdropFilter: "blur(12px)",
    border: `1px solid ${meta.accent}55`,
    borderRadius: 8,
    boxShadow: `0 16px 44px rgba(0,0,0,0.55), 0 0 0 1px rgba(201,168,76,0.06)`,
    fontFamily: "monospace",
    color: "rgba(255,248,220,0.9)",
  };

  return (
    <div style={panel} role="dialog" aria-label={`${meta.name} inspector`}>
      {/* Accent top hairline */}
      <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${meta.accent}, transparent)`, borderRadius: "8px 8px 0 0" }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 10px 8px" }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", marginTop: 4, flexShrink: 0, background: meta.accent, boxShadow: `0 0 8px ${meta.accent}aa` }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "Georgia,serif", fontSize: 13, lineHeight: 1.2 }}>
            <RichText component={nameComponent} />
          </div>
          <div style={{ fontSize: 8.5, color: "rgba(255,248,220,0.5)", letterSpacing: "0.06em", marginTop: 2 }}>
            {meta.role} · {roomLabel(rt.roomKey)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${GOLD}33`, color: "rgba(255,248,220,0.7)", borderRadius: 4, width: 22, height: 22, cursor: "pointer", fontSize: 12, lineHeight: 1, flexShrink: 0 }}
        >×</button>
      </div>

      <div style={{ height: 1, background: `${GOLD}22`, margin: "0 10px" }} />

      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Status */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", fontSize: 9, letterSpacing: "0.06em", color: sm.color, background: `${sm.color}14`, border: `1px solid ${sm.color}44`, borderRadius: 999, padding: "2px 8px" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: sm.color }} />
          {sm.label}
        </span>

        {/* Owns + progress */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", color: `${GOLD}aa`, fontFamily: "Georgia,serif" }}>Owns right now</div>
          {hasOwns ? (
            <>
              <div style={{ fontSize: 11, lineHeight: 1.45, color: "rgba(255,248,220,0.85)", background: `${meta.accent}0f`, border: `1px solid ${meta.accent}33`, borderRadius: 4, padding: "6px 8px" }}>{rt.owns}</div>
              <div style={{ height: 3, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${rt.progress}%`, background: rt.state === "complete" ? "#22c55e" : meta.accent, transition: "width 0.4s ease" }} />
              </div>
              <div style={{ fontSize: 8.5, color: "rgba(255,248,220,0.45)", alignSelf: "flex-end" }}>{rt.progress}%</div>
            </>
          ) : (
            <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "rgba(255,248,220,0.5)" }}>Idle — no active deliverable. {meta.idleLine}</div>
          )}
        </div>

        {/* Thinking — the executive's most recent line on the floor. */}
        {lastThought && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={EYEBROW}>Thinking</div>
            <div style={{ fontSize: 10, lineHeight: 1.5, fontStyle: "italic", color: "rgba(255,248,220,0.72)", borderLeft: `2px solid ${meta.accent}66`, paddingLeft: 8 }}>
              “{lastThought.text}”
              <span style={{ marginLeft: 6, fontStyle: "normal", fontSize: 8, color: "rgba(255,248,220,0.35)" }}>{relativeTime(lastThought.ts, now)}</span>
            </div>
          </div>
        )}

        {/* Why this agent */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", color: `${GOLD}aa`, fontFamily: "Georgia,serif" }}>Why this agent?</div>
          <div style={{ fontSize: 10, lineHeight: 1.5, color: "rgba(255,248,220,0.6)" }}>{WHY[agentId]}</div>
        </div>

        {/* Competency — skills, derived traits, and shipped-based standing. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", color: `${GOLD}aa`, fontFamily: "Georgia,serif" }}>Competency</div>
            <span
              title={`${shipped} output${shipped === 1 ? "" : "s"} shipped`}
              style={{ fontSize: 8.5, letterSpacing: "0.06em", color: meta.accent, background: `${meta.accent}18`, border: `1px solid ${meta.accent}44`, borderRadius: 999, padding: "1px 7px" }}
            >
              Lv {rep.level} · {shipped} shipped
            </span>
          </div>

          {/* Skill chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {sheet.skills.map((sk) => (
              <span
                key={sk}
                style={{ fontSize: 9, color: "rgba(255,248,220,0.72)", background: "rgba(255,255,255,0.04)", border: `1px solid ${GOLD}2e`, borderRadius: 3, padding: "1px 6px" }}
              >
                {SKILL_LABELS[sk]}
              </span>
            ))}
          </div>

          {/* Derived-trait descriptor + mini bars */}
          <div style={{ fontSize: 9.5, fontStyle: "italic", color: "rgba(255,248,220,0.55)" }}>{traitDescriptor(sheet.attributes)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {TRAIT_KEYS.map((k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 66, flexShrink: 0, fontSize: 8, letterSpacing: "0.04em", color: "rgba(255,248,220,0.5)" }}>{TRAIT_LABELS[k]}</span>
                <span style={{ flex: 1, height: 3, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${traits[k]}%`, background: `${meta.accent}cc` }} />
                </span>
                <span style={{ width: 18, textAlign: "right", fontSize: 8, color: "rgba(255,248,220,0.4)" }}>{traits[k]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Track record (#62 memory) — precedents this executive has shipped,
            a live projection of the audit trail. */}
        {precedents.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={EYEBROW}>Track record</div>
            {precedents.map((p) => (
              <div key={p.auditEventId} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, color: "rgba(255,248,220,0.7)" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: p.outcome === "complete" ? "#22c55e" : "#ef4444" }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.label}>{p.label}</span>
                <span style={{ fontSize: 8, color: "rgba(255,248,220,0.35)", flexShrink: 0 }}>{relativeTime(p.ts, now)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Recent activity — this executive's own audit entries, newest-first. */}
        {recentActivity.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={EYEBROW}>Recent activity</div>
            {recentActivity.map((e) => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, color: "rgba(255,248,220,0.6)" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: AUDIT_STATUS_COLOR[e.status] }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.action}>{e.action}</span>
                <span style={{ fontSize: 8, color: "rgba(255,248,220,0.35)", flexShrink: 0 }}>{relativeTime(e.ts, now)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Reassign picker */}
        {picking && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, border: `1px solid ${GOLD}22`, borderRadius: 4, padding: 8 }}>
            <div style={{ fontSize: 8.5, color: "rgba(255,248,220,0.55)", marginBottom: 2 }}>Reassign “{rt.owns}” to:</div>
            {targets.length === 0 ? (
              <div style={{ fontSize: 9.5, color: "rgba(255,248,220,0.4)" }}>No idle executive is available to take this over.</div>
            ) : targets.map((tid) => (
              <button
                key={tid}
                type="button"
                onClick={() => { reassignAgentTask(agentId, tid); setPicking(false); }}
                style={{ display: "flex", alignItems: "center", gap: 6, textAlign: "left", background: "rgba(255,255,255,0.03)", border: `1px solid ${AGENT_BY_ID[tid].accent}33`, borderRadius: 4, padding: "5px 7px", cursor: "pointer", color: "rgba(255,248,220,0.85)", fontSize: 10 }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: AGENT_BY_ID[tid].accent }} />
                {AGENT_BY_ID[tid].name}
                <span style={{ marginLeft: "auto", fontSize: 8, color: "rgba(255,248,220,0.4)" }}>{AGENT_BY_ID[tid].role}</span>
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <ActionButton label="Talk" onClick={() => interactWithAgent(agentId)} />
          <ActionButton label="Review output" disabled={!hasOwns} onClick={() => requestAgentReview(agentId)} />
          <ActionButton
            label={picking ? "Cancel reassign" : "Reassign"}
            disabled={!hasOwns || (targets.length === 0 && !picking)}
            onClick={() => setPicking((p) => !p)}
          />
          <ActionButton label="Ask Earn" primary onClick={onAskEarn} />
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  label, onClick, disabled, primary,
}: {
  label: string; onClick: () => void; disabled?: boolean; primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 6px",
        borderRadius: 4,
        fontFamily: "Georgia,serif",
        fontSize: 9.5,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        color: primary ? "#0a0806" : GOLD,
        background: primary ? GOLD : `${GOLD}14`,
        border: `1px solid ${GOLD}${primary ? "" : "44"}`,
      }}
    >{label}</button>
  );
}
