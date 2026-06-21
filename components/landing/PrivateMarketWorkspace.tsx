"use client";

import { useEffect, useState } from "react";
import {
  HQ_AGENTS,
  HQ_LOGS,
  HQ_STATES,
  activeAgentCount,
  isAgentMoving,
  nextHQStateOnPrompt,
  type HQState,
} from "@/lib/private-market-workspace";

const FIRM_NAME = "FundExecs";

const SUITES = [
  { name: "Capital Formation", x: "8%", y: "13%", w: "28%", h: "24%" },
  { name: "Executive Council", x: "38%", y: "7%", w: "24%", h: "20%" },
  { name: "Underwriting", x: "65%", y: "13%", w: "27%", h: "24%" },
  { name: "Portfolio Operations", x: "8%", y: "62%", w: "28%", h: "25%" },
  { name: "Legal & Compliance", x: "64%", y: "62%", w: "28%", h: "25%" },
];

function stateClass(state: HQState): string {
  return {
    idle: "opacity-70",
    activated: "opacity-100",
    semiActive: "opacity-100",
    fullyActive: "opacity-100",
  }[state];
}

export function PrivateMarketWorkspace() {
  const [state, setState] = useState<HQState>("idle");
  const [prompt, setPrompt] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("Earn");

  useEffect(() => {
    const timer = setTimeout(() => setState((current) => (current === "idle" ? "activated" : current)), 700);
    return () => clearTimeout(timer);
  }, []);

  const selected = HQ_AGENTS.find((agent) => agent.name === selectedAgent) ?? HQ_AGENTS[0];
  const meta = HQ_STATES[state];
  const logs = HQ_LOGS[state];

  function handlePrompt(value: string) {
    setPrompt(value);
    setState((current) => nextHQStateOnPrompt(current, value));
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="grid gap-6 lg:grid-cols-[0.88fr_1.12fr]">
        {/* Cursor/Tasklet-style conversation pane */}
        <div className="rounded-[1.75rem] border border-line bg-surface-1/70 shadow-[0_24px_70px_-48px_rgb(0_0_0/0.9)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
                Earn conversation
              </p>
              <p className="mt-1 text-sm font-medium text-fg-primary">{meta.label}</p>
            </div>
            <span className="rounded-full border border-line bg-surface-0 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              {activeAgentCount(state)} active
            </span>
          </div>

          <div className="space-y-3 p-4">
            <div className="rounded-2xl rounded-bl-sm border border-line bg-surface-0 px-4 py-3">
              <p className="text-sm text-fg-secondary">
                Ask Earn to coordinate capital work. The HQ state changes as the conversation moves from prompt to plan to automation.
              </p>
            </div>
            <div className="ml-8 rounded-2xl rounded-br-sm bg-gold-400 px-4 py-3 text-sm font-medium text-surface-0">
              Source LPs, prepare a lender list, underwrite the deal, and draft the IC memo.
            </div>
            <div className="rounded-2xl rounded-bl-sm border border-gold-500/25 bg-surface-0 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                Earn proposal
              </p>
              <p className="mt-2 text-sm text-fg-secondary">
                Build the plan, query each executive office, then decide whether Earn leads or the full team takes over.
              </p>
              <ol className="mt-3 space-y-1 text-xs text-fg-muted">
                <li>1. Capital Formation qualifies LP and lender paths.</li>
                <li>2. Underwriting builds the model and risk range.</li>
                <li>3. Legal & Compliance checks approval gates.</li>
                <li>4. Executive Council prepares the final artifact pack.</li>
              </ol>
            </div>

            <textarea
              value={prompt}
              onChange={(event) => handlePrompt(event.target.value)}
              rows={3}
              placeholder="Type to activate the HQ..."
              className="w-full resize-none rounded-xl border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-500"
            />

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setState("semiActive")}
                className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/15"
              >
                Accept strategy
              </button>
              <button
                type="button"
                onClick={() => setState("fullyActive")}
                className="rounded-lg bg-gold-400 px-3 py-2 text-sm font-semibold text-surface-0 transition hover:opacity-90"
              >
                Approve &amp; Automate
              </button>
            </div>
          </div>
        </div>

        {/* Digital HQ pane */}
        <div className="overflow-hidden rounded-[1.75rem] border border-line bg-[#07111f] shadow-[0_24px_90px_-54px_rgb(var(--fx-accent-rgb)/0.85)]">
          <div className="flex items-center justify-between border-b border-line bg-surface-0/60 px-4 py-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
                Private Market Ecosystem
              </p>
              <p className="mt-1 text-sm text-fg-secondary">{meta.description}</p>
            </div>
            <span className="rounded-full border border-status-success/35 bg-status-success/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-status-success">
              {meta.motion}
            </span>
          </div>

          <div className={`relative min-h-[560px] overflow-hidden transition duration-500 ${stateClass(state)}`}>
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:28px_28px]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(56,189,248,0.18),transparent_34%),radial-gradient(circle_at_50%_45%,rgba(214,162,74,0.12),transparent_52%)]" />
            <div className="absolute left-1/2 top-1/2 h-28 w-40 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gold-500/45 bg-surface-0/85 p-3 text-center shadow-[0_0_42px_-18px_rgb(var(--fx-accent-rgb)/0.95)]">
              <p className="font-mono text-[10px] uppercase tracking-wider text-gold-300">Executive Offices of {FIRM_NAME}</p>
              <p className="mt-2 text-sm font-semibold text-fg-primary">Earn</p>
              <p className="mt-1 text-[10px] text-fg-muted">Headquarters router</p>
            </div>

            {SUITES.map((suite) => (
              <div
                key={suite.name}
                className="absolute rounded-2xl border border-line/80 bg-surface-0/74 p-3 backdrop-blur transition hover:border-gold-500/45"
                style={{ left: suite.x, top: suite.y, width: suite.w, height: suite.h }}
              >
                <p className="font-mono text-[10px] uppercase tracking-wider text-gold-300">
                  Executive Offices of {FIRM_NAME}
                </p>
                <p className="mt-2 text-sm font-medium text-fg-primary">{suite.name} Suite</p>
              </div>
            ))}

            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              {SUITES.map((suite, index) => (
                <line
                  key={suite.name}
                  x1="50%"
                  y1="50%"
                  x2={`${[22, 50, 78, 22, 78][index]}%`}
                  y2={`${[25, 17, 25, 73, 73][index]}%`}
                  stroke={state === "idle" ? "rgba(113,132,158,0.28)" : "rgba(56,189,248,0.58)"}
                  strokeWidth="2"
                  strokeDasharray={state === "fullyActive" ? "7 7" : "0"}
                />
              ))}
            </svg>

            {HQ_AGENTS.map((agent) => {
              const moving = isAgentMoving(state, agent.name);
              const selectedAgent = selected.name === agent.name;
              return (
                <button
                  key={agent.name}
                  type="button"
                  onClick={() => setSelectedAgent(agent.name)}
                  className={`absolute z-10 flex h-12 w-12 items-center justify-center rounded-xl border text-sm font-bold transition ${
                    selectedAgent ? "border-gold-500 bg-gold-500 text-surface-0" : "border-line bg-surface-1 text-fg-primary"
                  } ${moving ? "animate-glow shadow-[0_0_24px_-8px_rgb(var(--fx-accent-rgb)/0.95)]" : ""}`}
                  style={{ left: `${agent.x}%`, top: `${agent.y}%`, transform: "translate(-50%, -50%)" }}
                  aria-label={`${agent.name}, ${agent.title}`}
                >
                  {agent.name.slice(0, 1)}
                </button>
              );
            })}

          </div>

          <div className="border-t border-line bg-surface-0/70 p-4">
            <div className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                  {selected.name}
                </p>
                <p className="mt-1 text-sm font-semibold text-fg-primary">{selected.title}</p>
                <p className="mt-1 text-xs text-fg-muted">{selected.suite}</p>
              </div>
              <div className={`rounded-xl border px-3 py-2 font-mono text-[10px] ${
                state === "fullyActive"
                  ? "border-status-success/35 bg-black/80 text-status-success"
                  : "border-line bg-surface-1 text-fg-muted"
              }`}>
                {state === "fullyActive" ? (
                  <p className="mb-1 uppercase tracking-[0.18em]">Workclaw automation stream</p>
                ) : null}
                {logs.map((line) => (
                  <p key={line}>{state === "fullyActive" ? "$" : "›"} {line}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
