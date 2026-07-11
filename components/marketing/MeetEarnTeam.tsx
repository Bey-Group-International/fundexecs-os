import { AGENTS } from "@/lib/agents";
import { GradientText } from "./GradientText";
import { AccessGate } from "./AccessGate";

// "Meet Earn" reveal. Earn (the associate/orchestrator) is featured as the
// executive who runs the OS, with the full native workforce spread beneath as a
// locked roster. Data is pulled live from lib/agents.ts so the card never drifts
// from the real seed catalog. The roster fades into the AccessGate scrim, making
// the section a preview a visitor can see but not enter without an account.
const EARN = AGENTS.find((a) => a.key === "associate");
const TEAM = AGENTS.filter((a) => a.key !== "associate");

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function MeetEarnTeam() {
  return (
    <section
      id="meet-earn"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
          Meet the team
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          <GradientText as="span">Earn</GradientText> and the executive
          workforce that reports to it.
        </h2>
        <p className="mt-3 text-fg-secondary">
          One orchestrator directs {TEAM.length} specialist AI executives across
          sourcing, capital, diligence, and delivery — every one visible before
          you commit.
        </p>
      </div>

      {/* Earn — the featured orchestrator */}
      {EARN && (
        <div className="fx-card mx-auto mt-10 max-w-3xl p-6 sm:p-8">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <span
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-semibold text-surface-0 shadow-lg"
              style={{ backgroundColor: EARN.color }}
            >
              {initials(EARN.name)}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-semibold text-fg-primary">
                  {EARN.name}
                </h3>
                <span className="rounded-full border border-gold-500/30 bg-gold-500/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold-300">
                  Orchestrator
                </span>
              </div>
              <p className="mt-2 text-sm text-fg-secondary">{EARN.role}</p>
            </div>
          </div>
        </div>
      )}

      {/* The locked roster */}
      <div className="relative mt-6">
        <div
          aria-hidden
          className="pointer-events-none select-none [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM.map((agent) => (
              <div key={agent.key} className="fx-card p-4">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-surface-0"
                    style={{ backgroundColor: agent.color }}
                  >
                    {initials(agent.name)}
                  </span>
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-fg-primary">
                      {agent.name}
                    </h4>
                    {agent.hub && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        {agent.hub} hub
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-fg-secondary">
                  {agent.role}
                </p>
              </div>
            ))}
          </div>
        </div>

        <AccessGate
          title="Meet the full executive team"
          subtitle="Sign in or request access to brief Earn, assign the workforce, and put the roster to work on your mandate."
        />
      </div>
    </section>
  );
}
