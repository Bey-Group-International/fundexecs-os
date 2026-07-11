import { AGENTS } from "@/lib/agents";
import { Reveal } from "./Reveal";

// "Explore Workspace" reveal. A faithful static mock of the screen users land on
// after login (app/(app)/workspace/page.tsx): the "Sessions" header, the AI
// Operating Brief card, the recent-session list, and Earn's composer docked at
// the bottom. Sample data only — no live sessions. Sign-in / request-access live
// in the page header and footer, so this section carries no CTA of its own.
const SAMPLE_SESSIONS = [
  { name: "Maple Street acquisition — underwrite", group: "Run · Diligence", color: "#22d3ee", when: "12m ago" },
  { name: "Q3 LP capital call — draft & send", group: "Execute · Investor Relations", color: "#f59e0b", when: "1h ago" },
  { name: "Founding Capital Circle outreach", group: "Source · Capital Raiser", color: "#ec4899", when: "3h ago" },
  { name: "Northwind data room — risk flags", group: "Run · Diligence", color: "#ef4444", when: "yesterday" },
] as const;

function earnColor() {
  return AGENTS.find((a) => a.key === "associate")?.color ?? "#6366f1";
}

export function WorkspacePreview() {
  return (
    <section
      id="workspace-preview"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24"
    >
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
          The workspace
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          Every objective picks up where you left off.
        </h2>
        <p className="mt-3 text-fg-secondary">
          Land in one command surface: an AI operating brief on what needs you,
          your live sessions, and Earn&rsquo;s composer ready for the next move.
        </p>
      </Reveal>

      <Reveal delayMs={120} className="mt-10">
        <div className="fx-glass mx-auto max-w-3xl p-4 sm:p-6">
          {/* Header */}
          <div className="mb-5">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
              FundExecs OS
            </span>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-fg-primary">
              Sessions
            </h3>
          </div>

          {/* AI Operating Brief */}
          <div className="fx-card relative overflow-hidden p-4">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgb(var(--fx-accent-rgb)/0.14),transparent_36%)]"
            />
            <div className="relative flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.24em] text-gold-400">
                  <span className="animate-pulse inline-block h-1.5 w-1.5 rounded-full bg-gold-400" aria-hidden />
                  AI Operating Brief
                </p>
                <h4 className="mt-1 text-lg font-semibold tracking-tight text-fg-primary">
                  2 approvals waiting and the Maple Street model is ready to review.
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
                  <span className="font-medium text-fg-primary">Next:</span> Approve
                  the Q3 capital-call notice so Investor Relations can send it.
                </p>
                <div className="mt-3 h-1 w-full max-w-xs overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="fx-progress-loop h-full rounded-full"
                    style={{ backgroundColor: earnColor() }}
                  />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <span
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-surface-0"
                  style={{ backgroundColor: earnColor() }}
                >
                  Start Earn
                </span>
                <span className="rounded-lg border border-line px-4 py-2 text-sm text-fg-secondary">
                  Focus composer
                </span>
              </div>
            </div>
          </div>

          {/* Recent sessions */}
          <h4 className="mb-3 mt-6 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
            Recent
          </h4>
          <div className="flex flex-col gap-1.5">
            {SAMPLE_SESSIONS.map((s) => (
              <div
                key={s.name}
                className="fx-card flex items-center gap-3 px-4 py-3"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg-primary">
                    {s.name}
                  </span>
                  <span className="block truncate text-[11px] text-fg-muted">
                    {s.group}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-fg-muted">
                  {s.when}
                </span>
                <span className="shrink-0 font-mono text-fg-muted">→</span>
              </div>
            ))}
          </div>

          {/* Earn composer */}
          <div className="mt-6 border-t border-line/60 pt-4">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-1/60 px-3 py-2.5">
              <span className="flex min-w-0 flex-1 items-center text-sm text-fg-muted">
                <span className="fx-typewriter">Ask Earn to move something forward…</span>
                <span
                  className="fx-caret ml-0.5 inline-block h-4 w-px shrink-0 bg-fg-secondary"
                  aria-hidden
                />
              </span>
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-surface-0"
                style={{ backgroundColor: earnColor() }}
                aria-hidden
              >
                ↑
              </span>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
