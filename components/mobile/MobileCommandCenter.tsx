import Link from "next/link";
import { MobileEarnPanel } from "./MobileEarnPanel";
import { MobileSectionHeader } from "./MobileSectionHeader";
import { MobileApprovalCard, type MobileApproval } from "./MobileApprovalCard";
import { MobileWorkflowCard, type MobileWorkflow } from "./MobileWorkflowCard";
import { MobileDealCard, type MobileDeal } from "./MobileDealCard";
import { MobileStatTile, MobileNextAction, type CommandStat } from "./MobileCommandCard";
import { PullToRefresh } from "./PullToRefresh";
import { relativeTime, initials } from "./format";
import { DealsIcon, ShieldIcon, TaskIcon, BellIcon } from "./icons";

export interface ActivityItem {
  id: string;
  text: string;
  at: string | null;
  href: string;
}

export interface CommandCenterData {
  name: string;
  greeting: string;
  dateLabel: string;
  counts: { deals: number; approvals: number; workflows: number; unread: number };
  nextAction: { eyebrow: string; title: string; body?: string; href: string; cta: string };
  approvals: MobileApproval[];
  workflows: MobileWorkflow[];
  deals: MobileDeal[];
  activity: ActivityItem[];
}

// One-line digest of what's on the plate right now — sits under the greeting so
// the answer to "what needs me?" is legible before any scrolling.
function digest(c: CommandCenterData["counts"]): string {
  const parts: string[] = [];
  if (c.approvals > 0) parts.push(`${c.approvals} to approve`);
  if (c.workflows > 0) parts.push(`${c.workflows} in motion`);
  if (c.deals > 0) parts.push(`${c.deals} active deal${c.deals === 1 ? "" : "s"}`);
  if (c.unread > 0) parts.push(`${c.unread} unread`);
  return parts.length ? parts.join("  ·  ") : "You're all caught up.";
}

// The mobile App Home / Command Center — the app's landing surface. Answers
// "what needs my attention right now?" with an executive hero + digest, the
// Earn entry point, a single recommended next action, then pending approvals,
// active workflows, priority deals, and recent activity. Pull down to refresh.
// Composed entirely of summary-first, tappable cards; rendered inside the
// `md:hidden` app shell.
export function MobileCommandCenter({ data }: { data: CommandCenterData }) {
  const stats: CommandStat[] = [
    { label: "Deals", value: data.counts.deals, href: "/deals/feed", icon: DealsIcon, tone: "gold" },
    { label: "Approvals", value: data.counts.approvals, href: "/inbox", icon: ShieldIcon, tone: data.counts.approvals > 0 ? "danger" : "neural" },
    { label: "Workflows", value: data.counts.workflows, href: "/automations", icon: TaskIcon, tone: "neural" },
    { label: "Inbox", value: data.counts.unread, href: "/inbox", icon: BellIcon, tone: "success" },
  ];

  return (
    <PullToRefresh>
      <div className="mx-auto max-w-lg space-y-5">
        {/* Executive hero */}
        <header className="relative -mx-4 -mt-5 overflow-hidden px-4 pb-1 pt-6 sm:-mx-6 sm:px-6">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_85%_-10%,rgb(var(--fx-gold-rgb)/0.12),transparent_60%),radial-gradient(120%_90%_at_0%_-20%,rgb(var(--fx-accent-rgb)/0.12),transparent_55%)]"
          />
          <div className="relative flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10 font-display text-[15px] font-semibold text-gold-300">
              {initials(data.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">{data.dateLabel}</p>
              <h1 className="mt-0.5 font-display text-[24px] font-semibold leading-tight tracking-tight text-fg-primary">
                {data.greeting}, {data.name.split(" ")[0]}
              </h1>
            </div>
            <Link
              href="/inbox"
              aria-label="Notifications"
              className="fx-tap relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-fg-secondary transition active:bg-surface-2"
            >
              <BellIcon width={18} height={18} />
              {data.counts.unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-status-danger ring-2 ring-surface-0" aria-hidden />
              )}
            </Link>
          </div>
          <p className="relative mt-2.5 text-[12.5px] font-medium text-fg-secondary">{digest(data.counts)}</p>
        </header>

        {/* Earn entry point */}
        <MobileEarnPanel name={data.name} />

        {/* Recommended next action — the single most important thing right now. */}
        <MobileNextAction {...data.nextAction} />

        {/* Snapshot */}
        <section className="grid grid-cols-4 gap-2">
          {stats.map((s) => (
            <MobileStatTile key={s.label} stat={s} />
          ))}
        </section>

        {/* Pending approvals */}
        {data.approvals.length > 0 && (
          <section>
            <MobileSectionHeader title="Pending approvals" count={data.counts.approvals} href="/inbox" />
            <div className="space-y-2.5">
              {data.approvals.map((a) => (
                <MobileApprovalCard key={a.id} approval={a} />
              ))}
            </div>
          </section>
        )}

        {/* Active workflows */}
        {data.workflows.length > 0 && (
          <section>
            <MobileSectionHeader title="Active workflows" count={data.counts.workflows} href="/automations" />
            <div className="space-y-2.5">
              {data.workflows.map((w) => (
                <MobileWorkflowCard key={w.id} workflow={w} />
              ))}
            </div>
          </section>
        )}

        {/* Priority deals */}
        {data.deals.length > 0 && (
          <section>
            <MobileSectionHeader title="Priority deals" href="/deals/feed" />
            <div className="space-y-2.5">
              {data.deals.map((d) => (
                <MobileDealCard key={d.id} deal={d} />
              ))}
            </div>
          </section>
        )}

        {/* Recent activity */}
        {data.activity.length > 0 && (
          <section>
            <MobileSectionHeader title="Recent activity" href="/activity" />
            <ul className="overflow-hidden rounded-2xl border border-line/60 bg-surface-1/70">
              {data.activity.map((item, i) => (
                <li key={item.id} className={i > 0 ? "border-t border-line/50" : ""}>
                  <Link href={item.href} className="fx-tap flex items-start gap-2.5 px-3.5 py-2.5 transition active:bg-surface-2">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neural-400/70" />
                    <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-fg-secondary">{item.text}</span>
                    {relativeTime(item.at) && (
                      <span className="shrink-0 text-[10px] text-fg-muted">{relativeTime(item.at)}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Empty-state fallback */}
        {data.approvals.length === 0 && data.workflows.length === 0 && data.deals.length === 0 && (
          <section className="rounded-2xl border border-dashed border-line/70 bg-surface-1/50 p-6 text-center">
            <p className="text-[14px] font-medium text-fg-primary">You&apos;re all clear</p>
            <p className="mt-1 text-[12.5px] text-fg-secondary">
              Ask Earn to source a deal, build your pipeline, or prep investor materials to get moving.
            </p>
            <Link
              href="/earn"
              className="fx-tap mt-3 inline-flex items-center gap-1.5 rounded-xl border border-gold-500/40 bg-gold-500/[0.08] px-4 py-2 text-[13px] font-semibold text-gold-300"
            >
              Ask Earn ›
            </Link>
          </section>
        )}
      </div>
    </PullToRefresh>
  );
}
