import Link from "next/link";
import { MobileEarnPanel } from "./MobileEarnPanel";
import { MobileSectionHeader } from "./MobileSectionHeader";
import { MobileApprovalCard, type MobileApproval } from "./MobileApprovalCard";
import { MobileWorkflowCard, type MobileWorkflow } from "./MobileWorkflowCard";
import { MobileDealCard, type MobileDeal } from "./MobileDealCard";
import { MobileStatTile, MobileNextAction, type CommandStat } from "./MobileCommandCard";
import { relativeTime } from "./format";
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

// The mobile App Home / Command Center. Answers "what needs my attention right
// now?" — Earn entry point, a recommended next action, pending approvals,
// active workflows, priority deals, and recent activity. Composed entirely of
// summary-first, tappable cards. Rendered inside the `md:hidden` app shell.
export function MobileCommandCenter({ data }: { data: CommandCenterData }) {
  const stats: CommandStat[] = [
    { label: "Active deals", value: data.counts.deals, href: "/deals/feed", icon: DealsIcon, tone: "gold" },
    { label: "Approvals", value: data.counts.approvals, href: "/inbox", icon: ShieldIcon, tone: data.counts.approvals > 0 ? "danger" : "neural" },
    { label: "Workflows", value: data.counts.workflows, href: "/automations", icon: TaskIcon, tone: "neural" },
    { label: "Inbox", value: data.counts.unread, href: "/inbox", icon: BellIcon, tone: "success" },
  ];

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {/* Greeting */}
      <header className="pt-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">{data.dateLabel}</p>
        <h1 className="mt-1 font-display text-[26px] font-semibold leading-tight tracking-tight text-fg-primary">
          {data.greeting}, {data.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-[13px] text-fg-secondary">Here&apos;s what needs you right now.</p>
      </header>

      {/* Earn entry point */}
      <MobileEarnPanel name={data.name} />

      {/* Snapshot */}
      <section className="grid grid-cols-4 gap-2">
        {stats.map((s) => (
          <MobileStatTile key={s.label} stat={s} />
        ))}
      </section>

      {/* Recommended next action */}
      <MobileNextAction {...data.nextAction} />

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
  );
}
