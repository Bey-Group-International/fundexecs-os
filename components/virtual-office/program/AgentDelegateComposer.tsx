"use client";

import { useState } from "react";
import { FloorOverlay } from "./FloorOverlay";

/** The subset of the proximity agent this composer needs. */
export type DelegateAgent = {
  agentId: string;
  name: string;
  role: string;
  accent: string;
};

/**
 * Role-appropriate quick tasks, keyed by office agent id. Chosen so a single tap
 * composes an actionable instruction that routes cleanly through Earn's planner
 * to the right specialist. Anything not listed falls back to GENERIC_TASKS.
 */
const QUICK_TASKS: Record<string, string[]> = {
  earn: ["Draft this week's priorities", "Summarize what needs my attention"],
  associate: ["Screen this deal", "Prepare the data room"],
  principal: ["Review the latest deal memo", "Flag risks in the current deal"],
  analyst: ["Build a base-case model", "Pull comparable transactions"],
  risk: ["Run a compliance check on this deal", "List actions awaiting approval"],
  legal: ["Review the NDA", "Draft the subscription documents"],
  investor_relations: ["Draft an LP update", "Prepare the quarterly letter"],
  treasury: ["Prepare a capital call", "Reconcile settlement status"],
  portfolio_ops: ["Pull the latest portfolio KPIs", "Update the operating plan"],
  ops_admin: ["Generate the fund admin report", "Check the compliance calendar"],
  business_dev: ["Map new sourcing partners", "Refresh the sourcing pipeline"],
};

const GENERIC_TASKS = ["Summarize where things stand", "Draft next steps"];

/** Lowercase the first character so "Screen this deal" reads as "Have Analyst screen this deal". */
function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * In-world delegation composer. Opened by "Give a task" on the proximity card
 * when the operator stands next to an executive: it frames an actionable
 * instruction (a role-aware quick task or free text) and hands it straight to
 * the Earn dock with autoSend, so the delegated work routes into a real gated
 * plan — visible in the dock and the Active Work panel. Approval tiers still
 * apply; nothing external-facing or capital-binding runs without sign-off.
 */
export function AgentDelegateComposer({
  agent,
  onClose,
}: {
  agent: DelegateAgent;
  onClose: () => void;
}) {
  const accent = agent.accent || "#c9a84c";
  const [task, setTask] = useState("");
  const quick = QUICK_TASKS[agent.agentId] ?? GENERIC_TASKS;

  const delegate = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    // Prefix with the exec's name so Earn's planner routes it to this specialist,
    // matching the dock's "Have <Name> …" convention.
    const prompt = `Have ${agent.name} ${lowerFirst(t)}`;
    window.dispatchEvent(
      new CustomEvent("earn:open-with-context", {
        detail: { execName: agent.name, prompt, autoSend: true },
      }),
    );
    onClose();
  };

  return (
    <FloorOverlay
      accent={accent}
      onClose={onClose}
      ariaLabel={`Delegate to ${agent.name}`}
      eyebrow="Delegate a task"
      title={agent.name}
      subtitle={agent.role}
      footer={
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => delegate(task)}
            disabled={!task.trim()}
            className="flex-1 rounded px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-opacity disabled:opacity-40"
            style={{ background: accent, color: "#0a0806", fontFamily: "Georgia, serif" }}
          >
            Delegate to {agent.name.split(" ")[0]}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-slate-300 transition-colors hover:text-slate-100"
            style={{ borderColor: "rgba(255,255,255,0.15)" }}
          >
            Cancel
          </button>
        </div>
      }
    >
      <div>
        <p className="mb-1.5 text-[8px] uppercase tracking-[0.16em] text-slate-500">Quick tasks</p>
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => delegate(q)}
              className="rounded-full border px-2.5 py-1 text-[11px] text-slate-200 transition-colors"
              style={{ borderColor: `${accent}3d`, background: `${accent}12` }}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[8px] uppercase tracking-[0.16em] text-slate-500">Or write your own</p>
        <textarea
          autoFocus
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              delegate(task);
            }
          }}
          rows={2}
          placeholder={`Tell ${agent.name.split(" ")[0]} what to do…`}
          className="w-full resize-none rounded-md border px-2.5 py-2 text-[12px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
          style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}
        />
      </div>

      <p className="text-[9px] leading-snug text-slate-500">
        Routes through Earn as a gated plan — external-facing and capital-binding work still needs your approval.
      </p>
    </FloorOverlay>
  );
}
