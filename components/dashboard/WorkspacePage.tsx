import Link from "next/link";
import { ExecutiveDialoguePanel } from "@/components/characters/ExecutiveDialoguePanel";
import {
  createDashboardDeal,
  createDashboardFund,
  createDashboardInvestor,
  createDashboardTask,
} from "@/lib/dashboard/actions";
import type { DashboardData, WorkspaceViewModel } from "@/lib/dashboard/types";
import { ActivityTimeline } from "./ActivityTimeline";
import { DealPipelineTable } from "./DealPipelineTable";
import { FundProgressTracker } from "./FundProgressTracker";
import { InvestorPipelineTable } from "./InvestorPipelineTable";
import { MetricCard } from "./MetricCard";
import { TaskQueue } from "./TaskQueue";

const inputClass =
  "rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-400";

function CreateInvestorForm() {
  return (
    <form action={createDashboardInvestor} className="grid gap-2">
      <input name="name" required placeholder="Investor or firm name" className={inputClass} />
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="contact_name" placeholder="Primary contact" className={inputClass} />
        <input name="contact_email" type="email" placeholder="Email" className={inputClass} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <select name="pipeline_stage" className={inputClass} defaultValue="prospect">
          <option value="prospect">Prospect</option>
          <option value="contacted">Contacted</option>
          <option value="diligence">Diligence</option>
          <option value="soft_commit">Soft commit</option>
          <option value="committed">Committed</option>
        </select>
        <input name="typical_check_min" inputMode="numeric" placeholder="Min check" className={inputClass} />
        <input name="typical_check_max" inputMode="numeric" placeholder="Max check" className={inputClass} />
      </div>
      <button className="rounded-lg bg-gold-500 px-3 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-400">
        Add investor
      </button>
    </form>
  );
}

function CreateDealForm() {
  return (
    <form action={createDashboardDeal} className="grid gap-2">
      <input name="name" required placeholder="Acquisition target" className={inputClass} />
      <div className="grid gap-2 sm:grid-cols-3">
        <input name="asset_class" placeholder="Industry / asset class" className={inputClass} />
        <input name="geography" placeholder="Geography" className={inputClass} />
        <input name="target_amount" inputMode="numeric" placeholder="Target amount" className={inputClass} />
      </div>
      <input name="source" placeholder="Source, broker, or referral" className={inputClass} />
      <button className="rounded-lg bg-gold-500 px-3 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-400">
        Add deal
      </button>
    </form>
  );
}

function CreateFundForm() {
  return (
    <form action={createDashboardFund} className="grid gap-2">
      <input name="name" required placeholder="Fund name" className={inputClass} />
      <div className="grid gap-2 sm:grid-cols-3">
        <input name="vintage_year" inputMode="numeric" placeholder="Vintage year" className={inputClass} />
        <input name="target_size" inputMode="numeric" placeholder="Target raise" className={inputClass} />
        <input name="committed_capital" inputMode="numeric" placeholder="Committed capital" className={inputClass} />
      </div>
      <button className="rounded-lg bg-gold-500 px-3 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-400">
        Create fund
      </button>
    </form>
  );
}

function CreateTaskForm({ hub, agent }: { hub: string; agent: string }) {
  return (
    <form action={createDashboardTask} className="grid gap-2">
      <input type="hidden" name="hub" value={hub} />
      <input type="hidden" name="assigned_agent" value={agent} />
      <input name="title" required placeholder="Next operating task" className={inputClass} />
      <textarea
        name="description"
        rows={3}
        placeholder="Context or acceptance criteria"
        className={inputClass}
      />
      <button className="rounded-lg border border-gold-500/45 px-3 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/10">
        Queue task
      </button>
    </form>
  );
}

function QuickActionPanel({ view }: { view: WorkspaceViewModel }) {
  const hubByWorkspace = {
    capital: "source",
    deals: "source",
    "fund-room": "build",
    "investor-relations": "execute",
    automation: "execute",
    marketing: "build",
    command: "source",
  } as const;

  return (
    <section className="fx-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-fg-muted">
          Quick action
        </h2>
        <Link href={view.primaryAction.href} className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline">
          {view.primaryAction.label} →
        </Link>
      </div>
      {view.key === "capital" ? <CreateInvestorForm /> : null}
      {view.key === "deals" ? <CreateDealForm /> : null}
      {view.key === "fund-room" ? <CreateFundForm /> : null}
      {!["capital", "deals", "fund-room"].includes(view.key) ? (
        <CreateTaskForm hub={hubByWorkspace[view.key]} agent={view.character.agentKey} />
      ) : null}
    </section>
  );
}

export function WorkspacePage({ view, data }: { view: WorkspaceViewModel; data: DashboardData }) {
  return (
    <div className="mx-auto max-w-6xl">
      <header className="fx-glass mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
              {view.eyebrow}
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary sm:text-4xl">
              {view.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-secondary">
              {view.description}
            </p>
          </div>
          <Link
            href="/dashboard/office"
            className="rounded-lg border border-gold-500/45 px-3 py-2 text-xs font-medium text-gold-300 transition hover:bg-gold-500/10"
          >
            Open visual office
          </Link>
        </div>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {view.metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {view.key === "capital" || view.key === "investor-relations" ? (
            <InvestorPipelineTable investors={data.investors} />
          ) : null}
          {view.key === "deals" ? <DealPipelineTable deals={data.deals} /> : null}
          {view.key === "fund-room" ? <FundProgressTracker funds={data.funds} /> : null}
          {view.key === "automation" ? (
            <section className="fx-card p-4">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
                Automation rules
              </h2>
              {data.automations.length === 0 ? (
                <p className="text-sm text-fg-muted">No automations configured yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.automations.map((automation) => (
                    <div key={automation.id} className="rounded-xl border border-line bg-surface-0/55 p-3">
                      <p className="text-sm text-fg-primary">{automation.name}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        {automation.trigger_type} · {automation.enabled ? "enabled" : "paused"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}
          {view.key === "marketing" ? (
            <section className="fx-card p-4">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
                Prototype board
              </h2>
              <p className="text-sm leading-6 text-fg-secondary">
                This workspace is data-ready for the next sprint. Queue tasks now; deeper native workflows can bind to
                campaigns, rooms, and sprite navigation as those assets arrive.
              </p>
            </section>
          ) : null}
          <TaskQueue tasks={view.tasks} />
        </div>
        <div className="space-y-6">
          <ExecutiveDialoguePanel
            character={view.character}
            recommendation={view.recommendation}
            context={`${view.character.name} can explain, recommend, create tasks, open workspaces, summarize activity, and flag missing information.`}
          />
          <QuickActionPanel view={view} />
          <ActivityTimeline activities={view.activities} />
        </div>
      </section>
    </div>
  );
}
