import Image from "next/image";
import { AGENTS } from "@/lib/agents";
import { GradientText } from "./GradientText";
import { AccessGate } from "./AccessGate";
import { Reveal } from "./Reveal";

// "Meet Earn" reveal. An institutional orchestration diagram: Earn (the
// associate/orchestrator) sits at the center as a portrait hub, with the full
// 14-executive workforce ringed around it and faint delegation spokes running
// out to each. Roster data is pulled LIVE from lib/agents.ts so the ring never
// drifts from the seed catalog. An AccessGate CTA below is the invitation in.
const EARN = AGENTS.find((a) => a.key === "associate");
const TEAM = AGENTS.filter((a) => a.key !== "associate");

const EARN_PHOTO = "/assets/fundexecs/characters/earnest-fundmaker/high-def.png";
// Radius of the executive ring, as a percentage of the (square) diagram box.
const RING_RADIUS = 42;

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Position each executive evenly around the ring, starting at the top (−90°).
const NODES = TEAM.map((agent, i) => {
  const angle = (-90 + (360 / TEAM.length) * i) * (Math.PI / 180);
  return {
    agent,
    i,
    x: 50 + RING_RADIUS * Math.cos(angle),
    y: 50 + RING_RADIUS * Math.sin(angle),
  };
});

export function MeetEarnTeam() {
  return (
    <section
      id="meet-earn"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24"
    >
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
          The executive team
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          <GradientText as="span">Earn</GradientText> orchestrates a{" "}
          {TEAM.length}-strong AI executive team.
        </h2>
        <p className="mt-3 text-fg-secondary">
          One orchestrator directs specialist executives across sourcing,
          capital, diligence, and execution — each accountable to a mandate you
          approve.
        </p>
      </Reveal>

      {/* Orchestration diagram */}
      <Reveal
        delayMs={120}
        className="relative mx-auto mt-12 aspect-square w-full max-w-[560px]"
      >
        {/* Delegation spokes — center to each executive */}
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full"
        >
          {NODES.map(({ agent, i, x, y }) => (
            <line
              key={agent.key}
              className="fx-spoke"
              style={{ animationDelay: `${(i % 7) * 0.4}s` }}
              x1="50"
              y1="50"
              x2={x}
              y2={y}
              stroke="rgb(148 163 184 / 0.22)"
              strokeWidth="0.4"
            />
          ))}
          <circle
            cx="50"
            cy="50"
            r={RING_RADIUS}
            fill="none"
            stroke="rgb(148 163 184 / 0.12)"
            strokeWidth="0.3"
            strokeDasharray="1 1.5"
          />
        </svg>

        {/* Earn — the orchestrator hub */}
        <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
          <div className="relative h-24 w-24 sm:h-28 sm:w-28">
            <span
              aria-hidden
              className="fx-earn-halo absolute -inset-2 rounded-full bg-gold-500/25 blur-md"
            />
            <div className="relative h-full w-full overflow-hidden rounded-full border-2 border-gold-400/70 shadow-[0_0_30px_-6px_rgb(var(--fx-accent-rgb)/0.6)]">
              <Image
                src={EARN_PHOTO}
                alt="Earn, the orchestrator executive"
                fill
                sizes="112px"
                className="object-cover"
              />
            </div>
          </div>
          <span className="mt-2 rounded-full border border-gold-500/30 bg-surface-0/80 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold-300 backdrop-blur">
            Earn · Orchestrator
          </span>
        </div>

        {/* The 14 executives, ringed around Earn */}
        {NODES.map(({ agent, i, x, y }) => (
          <div
            key={agent.key}
            className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${x}%`, top: `${y}%` }}
            aria-label={`${agent.name} — ${agent.role}`}
            title={agent.role}
          >
            <span
              className="fx-team-node flex h-11 w-11 items-center justify-center rounded-full text-xs font-semibold text-surface-0 shadow-md ring-2 ring-surface-0 sm:h-14 sm:w-14 sm:text-sm"
              style={{ backgroundColor: agent.color, animationDelay: `${(i % 7) * 0.6}s` }}
            >
              {initials(agent.name)}
            </span>
            <span className="mt-1 hidden max-w-[84px] text-center text-[10px] font-medium leading-tight text-fg-secondary sm:block">
              {agent.name}
            </span>
          </div>
        ))}
      </Reveal>

      {/* Hub legend — institutional key to how the workforce is organized */}
      <Reveal
        delayMs={80}
        className="mx-auto mt-10 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-line/60 pt-6 font-mono text-[10px] uppercase tracking-wider text-fg-muted"
      >
        <span>Sourcing</span>
        <span aria-hidden>·</span>
        <span>Capital</span>
        <span aria-hidden>·</span>
        <span>Diligence</span>
        <span aria-hidden>·</span>
        <span>Execution</span>
        <span aria-hidden>·</span>
        <span className="text-gold-300">Every move approved by you</span>
      </Reveal>

      <AccessGate
        title="Put the team to work"
        subtitle="Sign in or request access to brief Earn, assign the workforce, and put the roster to work on your mandate."
      />
    </section>
  );
}
