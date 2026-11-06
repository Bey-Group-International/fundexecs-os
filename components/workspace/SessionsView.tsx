import Link from "next/link";
import type { Session } from "@/lib/supabase/database.types";
import type { OperatingBrief } from "@/lib/operating-brief";
import { StartEarnButton } from "@/components/workspace/StartEarnButton";

// Presentational pieces of the Sessions page. They live here, not in the page
// file, because Next allows a page file only its default export, and these need
// to be rendered on their own by the browser layout test.

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function SessionsHeader() {
  return (
    <header className="mb-8 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
          FundExecs OS
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Sessions
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Every conversation with Earn — pick up where you left off or start something new.
        </p>
      </div>
      {/* The composer sits below the lists, and there can be fifty sessions. This
          is the one always-visible way to get to it. */}
      <a href="#earn-composer" className="fx-btn-primary shrink-0">
        New conversation
      </a>
    </header>
  );
}

export function OperatingBriefCard({ brief }: { brief: OperatingBrief }) {
  const primaryAttention = brief.needsAttention[0] ?? "You're caught up — nothing needs attention.";
  const primaryNextAction = brief.nextActions[0] ?? "Ask Earn what to move forward next.";

  return (
    <section className="mb-5">
      <div className="fx-card relative overflow-hidden p-4">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgb(var(--fx-accent-rgb)/0.14),transparent_36%)]"
        />
        <div className="relative flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
                AI Operating Brief
              </p>
              <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-fg-primary">
                {primaryAttention}
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-secondary">
                <span className="font-medium text-fg-primary">Next:</span> {primaryNextAction}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <StartEarnButton prompt={primaryNextAction} />
            </div>
          </div>

          <details className="group rounded-xl border border-line/70 bg-surface-0/70 px-3 py-2">
            <summary className="flex min-h-9 cursor-pointer list-none items-center text-sm text-fg-secondary transition hover:text-fg-primary">
              Show context and executive team
              <span className="ml-2 text-gold-300 group-open:hidden">+</span>
              <span className="ml-2 hidden text-gold-300 group-open:inline">-</span>
            </summary>
            <div className="mt-3 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                  Active context
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {brief.context.map((line) => (
                    <span
                      key={line}
                      className="rounded-full border border-line bg-surface-1 px-2.5 py-1 text-[11px] text-fg-secondary"
                    >
                      {line}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                  Suggested executive team
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {brief.suggestedRoles.map((role) => (
                    <div key={role.role} className="rounded-xl border border-line bg-surface-1 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-fg-primary">{role.label}</p>
                        <span className="rounded-full border border-gold-500/30 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-gold-300">
                          {role.approvalBoundary.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-snug text-fg-muted">{role.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-line bg-surface-1 p-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                Recommended next actions
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-snug text-fg-secondary">
                {brief.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

export function SessionCard({
  s,
  groupName,
}: {
  s: Session & { updated_at: string | null };
  groupName: string | null;
}) {
  return (
    <Link
      href={`/session/${s.id}`}
      className="fx-card fx-card-hover group flex items-center gap-3 px-4 py-3"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: s.color ?? "#a1a1aa" }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg-primary">{s.name}</span>
        {groupName && (
          <span className="block truncate text-xs text-fg-muted">{groupName}</span>
        )}
      </span>
      <span className="shrink-0 font-mono text-xs text-fg-muted">
        {relativeTime(s.updated_at ?? s.created_at ?? null)}
      </span>
      <span className="shrink-0 font-mono text-fg-muted transition group-hover:translate-x-0.5 group-hover:text-gold-300">
        →
      </span>
    </Link>
  );
}
