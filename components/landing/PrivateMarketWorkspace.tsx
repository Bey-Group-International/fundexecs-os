"use client";

import { useEffect, useState } from "react";
import {
  EXECUTION_LOGS,
  TASK_GRAPH,
  TWIN_AGENTS,
  TWIN_DISTRICTS,
  TWIN_PHASES,
  activeAgentCount,
  isAgentExecuting,
  nextTwinPhaseOnPrompt,
  taskNodeStatus,
  type SignalColor,
  type TwinAgent,
  type TwinPhase,
} from "@/lib/private-market-workspace";

const COMMANDS = [
  "Find acquisition targets",
  "Raise capital",
  "Build investor pipeline",
  "Source acquisition financing",
  "Prepare lender package",
];

const OUTCOMES = [
  "143 acquisition targets sourced",
  "21 qualified opportunities identified",
  "4 lender introductions generated",
  "Financing package completed",
  "Investor update drafted",
];

const ROUTES: Array<{ x1: number; y1: number; x2: number; y2: number; signal: SignalColor }> = [
  { x1: 50, y1: 48, x2: 50, y2: 16, signal: "green" },
  { x1: 50, y1: 48, x2: 19, y2: 24, signal: "gold" },
  { x1: 50, y1: 48, x2: 19, y2: 48, signal: "blue" },
  { x1: 50, y1: 48, x2: 20, y2: 73, signal: "navy" },
  { x1: 50, y1: 48, x2: 81, y2: 24, signal: "green" },
  { x1: 50, y1: 48, x2: 82, y2: 48, signal: "gold" },
  { x1: 50, y1: 48, x2: 82, y2: 74, signal: "blue" },
  { x1: 50, y1: 48, x2: 50, y2: 79, signal: "navy" },
];

function signalText(signal: SignalColor): string {
  return {
    gold: "text-[#f8c86a]",
    blue: "text-[#59c7ff]",
    green: "text-[#76ff8a]",
    navy: "text-[#8aa8ff]",
  }[signal];
}

function signalBorder(signal: SignalColor): string {
  return {
    gold: "border-[#f8c86a]/45 bg-[#f8c86a]/10",
    blue: "border-[#59c7ff]/45 bg-[#59c7ff]/10",
    green: "border-[#76ff8a]/45 bg-[#76ff8a]/10",
    navy: "border-[#8aa8ff]/45 bg-[#8aa8ff]/10",
  }[signal];
}

function signalFill(signal: SignalColor): string {
  return {
    gold: "bg-[#f8c86a]",
    blue: "bg-[#25d9ff]",
    green: "bg-[#39ff7a]",
    navy: "bg-[#5b76ff]",
  }[signal];
}

function signalStroke(signal: SignalColor, active: boolean): string {
  const alpha = active ? "0.82" : "0.24";
  return {
    gold: `rgba(248, 200, 106, ${alpha})`,
    blue: `rgba(37, 217, 255, ${alpha})`,
    green: `rgba(57, 255, 122, ${alpha})`,
    navy: `rgba(91, 118, 255, ${alpha})`,
  }[signal];
}

function phaseIsNeural(phase: TwinPhase): boolean {
  return ["planning", "authorized", "executing"].includes(phase);
}

function phaseIsFullyLit(phase: TwinPhase): boolean {
  return phase === "authorized" || phase === "executing";
}

function CapacityBar({ value }: { value: number }) {
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-0">
      <div
        className="h-full rounded-full bg-[linear-gradient(90deg,#1d4ed8,#25d9ff,#f8c86a)] transition-all duration-500"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function AgentSprite({
  agent,
  active,
  selected,
  onSelect,
}: {
  agent: TwinAgent;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const isEarn = agent.name === "Earn";
  return (
    <button
      type="button"
      onClick={onSelect}
      className="absolute z-20 flex flex-col items-center gap-1 transition duration-500"
      style={{
        left: `${agent.x}%`,
        top: `${agent.y}%`,
        transform: active ? "translate(-50%, calc(-50% - 4px))" : "translate(-50%, -50%)",
      }}
      aria-label={`${agent.name}, ${agent.title}`}
    >
      <span
        className={`relative grid ${isEarn ? "h-14 w-14" : "h-11 w-11"} place-items-center rounded-[0.65rem] border ${
          selected ? "border-white" : signalBorder(agent.signal)
        } ${active ? "shadow-[0_0_28px_-10px_currentColor]" : ""} ${signalText(agent.signal)}`}
      >
        {isEarn ? (
          <span className="absolute -inset-3 rounded-full border border-[#f8c86a]/30 bg-[#f8c86a]/10 blur-[1px]" />
        ) : null}
        <span className="absolute left-2 top-2 h-2 w-2 bg-current" />
        <span className="absolute right-2 top-2 h-2 w-2 bg-current" />
        <span className="absolute bottom-2 left-1/2 h-2 w-5 -translate-x-1/2 bg-current" />
        <span className="relative font-mono text-[11px] font-bold text-fg-primary">
          {agent.name === "Earn" ? "E" : agent.name.slice(0, 1)}
        </span>
      </span>
      <span className="max-w-[78px] rounded-full border border-line bg-surface-0/85 px-2 py-0.5 text-[9px] font-semibold text-fg-primary">
        {agent.name.replace(" Agent", "")}
      </span>
    </button>
  );
}

export function PrivateMarketWorkspace() {
  const [phase, setPhase] = useState<TwinPhase>("idle");
  const [prompt, setPrompt] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("Earn");

  useEffect(() => {
    const timer = setTimeout(() => setPhase((current) => (current === "idle" ? "prompt" : current)), 900);
    return () => clearTimeout(timer);
  }, []);

  const selected = TWIN_AGENTS.find((agent) => agent.name === selectedAgent) ?? TWIN_AGENTS[0];
  const meta = TWIN_PHASES[phase];
  const logs = EXECUTION_LOGS[phase];
  const neuralActive = phaseIsNeural(phase);
  const fullyLit = phaseIsFullyLit(phase);

  function handlePrompt(value: string) {
    setPrompt(value);
    setPhase((current) => nextTwinPhaseOnPrompt(current, value));
  }

  function handleCommand(command: string) {
    setPrompt(command);
    setPhase("prompt");
  }

  function advancePhase() {
    setPhase((current) => {
      if (current === "idle" || current === "prompt") return "planning";
      if (current === "planning") return "authorized";
      if (current === "authorized") return "executing";
      if (current === "executing") return "complete";
      return "idle";
    });
  }

  function primaryActionLabel() {
    if (phase === "idle" || phase === "prompt") return "Generate Plan";
    if (phase === "planning") return "Approve Execution";
    if (phase === "authorized") return "Start Autonomous Execution";
    if (phase === "executing") return "Complete Workflow";
    return "Reset Demo";
  }

  return (
    <section id="earn-action" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="mb-8 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-gold-400">
          See Earn in action
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
          Watch an autonomous private markets organization execute work.
        </h2>
        <p className="mt-4 text-fg-secondary">
          The demo links every visible movement to a workflow event: Earn analyzes,
          plans, waits for approval, delegates, and returns outcomes to the operator.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.72fr_1.56fr_0.72fr]">
        <div className="rounded-[1.5rem] border border-line bg-surface-1/80 shadow-[0_24px_70px_-48px_rgb(0_0_0/0.9)]">
          <div className="border-b border-line px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
              User Command Interface
            </p>
            <p className="mt-1 text-sm text-fg-secondary">Issue capital work in plain language.</p>
          </div>

          <div className="space-y-4 p-4">
            <div className="rounded-2xl border border-line bg-surface-0 p-4">
              <p className="text-sm font-semibold text-fg-primary">Command</p>
              <textarea
                value={prompt}
                onChange={(event) => handlePrompt(event.target.value)}
                rows={4}
                placeholder="Find acquisition targets, source financing, and prepare lender materials..."
                className="mt-3 w-full resize-none rounded-xl border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-500"
              />
            </div>

            <div className="space-y-2">
              {COMMANDS.map((command) => (
                <button
                  key={command}
                  type="button"
                  onClick={() => handleCommand(command)}
                  className="w-full rounded-xl border border-line bg-surface-0 px-3 py-2 text-left text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-fg-primary"
                >
                  {command}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={advancePhase}
              className="w-full rounded-xl bg-gold-400 px-4 py-3 text-sm font-semibold text-surface-0 transition hover:opacity-90"
            >
              {primaryActionLabel()}
            </button>

            <div className="rounded-2xl border border-line bg-surface-0 p-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  Execution Capacity
                </p>
                <span className="font-mono text-xs text-gold-300">{meta.capacity}%</span>
              </div>
              <CapacityBar value={meta.capacity} />
              <div className="mt-4 flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  System Throughput
                </p>
                <span className="font-mono text-xs text-[#76ff8a]">{meta.throughput}%</span>
              </div>
              <CapacityBar value={meta.throughput} />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[1.5rem] border border-line bg-[#050a12] shadow-[0_24px_90px_-54px_rgb(var(--fx-accent-rgb)/0.85)]">
          <div className="flex items-start justify-between gap-4 border-b border-line bg-surface-0/70 px-4 py-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
                Private Markets Digital Twin
              </p>
              <p className="mt-1 text-sm font-medium text-fg-primary">{meta.status}</p>
              <p className="mt-1 max-w-xl text-xs text-fg-muted">{meta.description}</p>
            </div>
            <span className="rounded-full border border-status-success/35 bg-status-success/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-status-success">
              {activeAgentCount(phase)} agents active
            </span>
          </div>

          <div className="relative min-h-[660px] overflow-hidden transition duration-500">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:28px_28px]" />
            <div className={`absolute inset-0 transition duration-500 ${
              fullyLit
                ? "bg-[radial-gradient(circle_at_50%_46%,rgba(248,200,106,0.24),transparent_28%),radial-gradient(circle_at_50%_46%,rgba(57,255,122,0.16),transparent_50%)]"
                : "bg-[radial-gradient(circle_at_50%_46%,rgba(56,189,248,0.14),transparent_34%)]"
            }`} />

            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              <defs>
                <filter id="neuralGlow">
                  <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {ROUTES.map((route, index) => (
                <line
                  key={`${route.x2}-${route.y2}`}
                  x1={`${route.x1}%`}
                  y1={`${route.y1}%`}
                  x2={`${route.x2}%`}
                  y2={`${route.y2}%`}
                  stroke={signalStroke(route.signal, neuralActive)}
                  strokeWidth={fullyLit ? 3 : 1.5}
                  strokeDasharray="8 10"
                  filter={neuralActive ? "url(#neuralGlow)" : undefined}
                >
                  {neuralActive ? (
                    <animate
                      attributeName="stroke-dashoffset"
                      from="0"
                      to="-90"
                      dur={`${1.6 + index * 0.12}s`}
                      repeatCount="indefinite"
                    />
                  ) : null}
                </line>
              ))}
            </svg>

            {TWIN_DISTRICTS.map((district) => (
              <div
                key={district.name}
                className={`absolute rounded-2xl border p-3 backdrop-blur transition duration-500 ${
                  fullyLit || (neuralActive && district.name === selected.district)
                    ? signalBorder(district.signal)
                    : "border-line/80 bg-surface-0/74"
                }`}
                style={{
                  left: `${district.x}%`,
                  top: `${district.y}%`,
                  width: `${district.w}%`,
                  height: `${district.h}%`,
                }}
              >
                <p className={`font-mono text-[9px] uppercase tracking-wider ${signalText(district.signal)}`}>
                  {district.name}
                </p>
                <p className="mt-2 max-w-[12rem] text-[11px] leading-snug text-fg-secondary">
                  {district.summary}
                </p>
              </div>
            ))}

            <div className={`absolute left-[34%] top-[28%] w-[32%] rounded-2xl border border-[#76ff8a]/30 bg-surface-0/72 p-3 backdrop-blur transition ${
              phase === "planning" || phase === "authorized" || phase === "executing" ? "opacity-100" : "opacity-40"
            }`}>
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#76ff8a]">
                Holographic Task Graph
              </p>
              <div className="mt-3 space-y-1.5">
                {TASK_GRAPH.slice(0, 5).map((node, index) => {
                  const status = taskNodeStatus(phase, index);
                  return (
                    <div key={node.title} className="flex items-center gap-2 text-[10px]">
                      <span className={`h-2 w-2 rounded-full ${
                        status === "complete" ? "bg-status-success" : status === "active" ? signalFill(node.signal) : "bg-fg-muted"
                      }`} />
                      <span className={status === "pending" ? "text-fg-muted" : "text-fg-primary"}>{node.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {phase === "executing" ? (
              <>
                <div className="absolute left-[10%] top-[22%] rounded-full border border-[#f8c86a]/50 bg-[#f8c86a]/15 px-3 py-1 font-mono text-[10px] text-[#f8c86a]">
                  LP match -&gt; intro -&gt; meeting
                </div>
                <div className="absolute left-[10%] top-[78%] rounded-full border border-[#8aa8ff]/50 bg-[#8aa8ff]/15 px-3 py-1 font-mono text-[10px] text-[#8aa8ff]">
                  Manufacturing target qualified
                </div>
                <div className="absolute right-[8%] top-[22%] rounded-full border border-[#76ff8a]/50 bg-[#76ff8a]/15 px-3 py-1 font-mono text-[10px] text-[#76ff8a]">
                  Risk score recalculated
                </div>
              </>
            ) : null}

            {TWIN_AGENTS.map((agent) => {
              const active = isAgentExecuting(phase, agent.name);
              return (
                <AgentSprite
                  key={agent.name}
                  agent={agent}
                  active={active}
                  selected={selected.name === agent.name}
                  onSelect={() => setSelectedAgent(agent.name)}
                />
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
                <p className="mt-1 text-xs text-fg-muted">{selected.district}</p>
                <p className="mt-2 text-xs text-fg-secondary">
                  {selected.responsibilities.join(" / ")}
                </p>
              </div>
              <div className={`rounded-xl border px-3 py-2 font-mono text-[10px] ${
                phase === "executing"
                  ? "border-status-success/35 bg-black/80 text-status-success"
                  : "border-line bg-surface-1 text-fg-muted"
              }`}>
                {phase === "executing" ? (
                  <p className="mb-1 uppercase tracking-[0.18em]">Autonomous execution stream</p>
                ) : null}
                {logs.map((line) => (
                  <p key={line}>{phase === "executing" ? "$" : ">"} {line}</p>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-line bg-surface-1/80 shadow-[0_24px_70px_-48px_rgb(0_0_0/0.9)]">
          <div className="border-b border-line px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
              Execution Plan + Task Graph
            </p>
            <p className="mt-1 text-sm text-fg-secondary">Acquire Manufacturing Company</p>
          </div>

          <div className="space-y-4 p-4">
            <div className="rounded-2xl border border-line bg-surface-0 p-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  Phase
                </p>
                <span className="rounded-full border border-line bg-surface-1 px-2 py-0.5 font-mono text-[10px] uppercase text-fg-secondary">
                  {meta.label}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-fg-primary">{meta.status}</p>
              <p className="mt-2 text-xs text-fg-muted">{meta.description}</p>
            </div>

            <div className="space-y-2">
              {TASK_GRAPH.map((node, index) => {
                const status = taskNodeStatus(phase, index);
                return (
                  <div
                    key={node.title}
                    className={`rounded-xl border px-3 py-3 transition ${
                      status === "active"
                        ? signalBorder(node.signal)
                        : status === "complete"
                          ? "border-status-success/35 bg-status-success/10"
                          : "border-line bg-surface-0"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-fg-primary">{node.title}</p>
                      <span className={`font-mono text-[9px] uppercase ${
                        status === "complete" ? "text-status-success" : status === "active" ? signalText(node.signal) : "text-fg-muted"
                      }`}>
                        {status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-fg-muted">{node.agent}</p>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-line bg-surface-0 p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Results Panel
              </p>
              <div className="mt-3 space-y-2">
                {OUTCOMES.map((outcome) => (
                  <p
                    key={outcome}
                    className={`text-xs ${
                      phase === "complete" ? "text-status-success" : "text-fg-muted"
                    }`}
                  >
                    {phase === "complete" ? "✓" : "-"} {outcome}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
