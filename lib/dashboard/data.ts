import { executiveCharacters, characterById } from "@/components/characters/characterConfig";
import { createServerClient } from "@/lib/supabase/server";
import { dashboardWorkspaces } from "./config";
import type {
  Approval,
  Automation,
  Deal,
  DispatchLog,
  Fund,
  Investor,
  Task,
} from "@/lib/supabase/database.types";
import type {
  DashboardActivity,
  DashboardData,
  DashboardMetric,
  DashboardWorkspaceKey,
  WorkspaceViewModel,
} from "./types";

const ACTIVE_TASKS = new Set(["pending", "in_progress", "awaiting_approval", "blocked"]);

function money(value: number | null | undefined): string {
  if (!value || value <= 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function latestActivity(tasks: Task[], dispatches: DispatchLog[]): DashboardActivity[] {
  const taskActivity = tasks.slice(0, 4).map((task) => ({
    id: task.id,
    title: task.title,
    detail: `${task.hub} · ${task.status.replace("_", " ")}`,
    createdAt: task.updated_at,
  }));
  const dispatchActivity = dispatches.slice(0, 4).map((dispatch) => ({
    id: dispatch.id,
    title: dispatch.action,
    detail: dispatch.detail ?? dispatch.channel,
    createdAt: dispatch.created_at,
  }));
  return [...taskActivity, ...dispatchActivity]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = createServerClient();
  const [
    investorsRes,
    dealsRes,
    fundsRes,
    tasksRes,
    approvalsRes,
    automationsRes,
    dispatchesRes,
  ] = await Promise.all([
    supabase.from("investors").select("*").order("updated_at", { ascending: false }).limit(12),
    supabase.from("deals").select("*").order("updated_at", { ascending: false }).limit(12),
    supabase.from("funds").select("*").order("updated_at", { ascending: false }).limit(8),
    supabase.from("tasks").select("*").order("updated_at", { ascending: false }).limit(12),
    supabase
      .from("approvals")
      .select("*")
      .eq("decision", "pending")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("automations").select("*").order("updated_at", { ascending: false }).limit(8),
    supabase.from("dispatch_log").select("*").order("created_at", { ascending: false }).limit(8),
  ]);

  const investors = (investorsRes.data ?? []) as Investor[];
  const deals = (dealsRes.data ?? []) as Deal[];
  const funds = (fundsRes.data ?? []) as Fund[];
  const tasks = (tasksRes.data ?? []) as Task[];
  const approvals = (approvalsRes.data ?? []) as Approval[];
  const automations = (automationsRes.data ?? []) as Automation[];
  const dispatches = (dispatchesRes.data ?? []) as DispatchLog[];
  const targetRaise = funds.reduce((sum, fund) => sum + (fund.target_size ?? 0), 0);
  const committed = funds.reduce((sum, fund) => sum + fund.committed_capital, 0);
  const activeTasks = tasks.filter((task) => ACTIVE_TASKS.has(task.status)).length;
  const activeAutomations = automations.filter((automation) => automation.enabled).length;

  const metrics: DashboardMetric[] = [
    {
      label: "Capital readiness",
      value: percent(committed, targetRaise),
      detail: `${money(committed)} committed of ${money(targetRaise)} target`,
      tone: committed > 0 ? "good" : "warn",
    },
    {
      label: "Investor pipeline",
      value: String(investors.length),
      detail: `${investors.filter((investor) => /commit|diligence|active/i.test(investor.pipeline_stage)).length} warm or active`,
      tone: investors.length > 0 ? "good" : "muted",
    },
    {
      label: "Deal pipeline",
      value: String(deals.length),
      detail: `${deals.filter((deal) => !["passed", "dead", "exited"].includes(deal.stage)).length} active targets`,
      tone: deals.length > 0 ? "good" : "muted",
    },
    {
      label: "Operating queue",
      value: String(activeTasks),
      detail: `${approvals.length} approval gate${approvals.length === 1 ? "" : "s"} pending`,
      tone: approvals.length > 0 ? "warn" : "good",
    },
    {
      label: "Automations",
      value: String(activeAutomations),
      detail: `${automations.length} workflow${automations.length === 1 ? "" : "s"} configured`,
      tone: activeAutomations > 0 ? "good" : "muted",
    },
  ];

  return {
    metrics,
    investors,
    deals,
    funds,
    tasks,
    approvals,
    automations,
    activities: latestActivity(tasks, dispatches),
    dispatches,
  };
}

export function getWorkspaceViewModel(
  key: DashboardWorkspaceKey,
  data: DashboardData,
): WorkspaceViewModel {
  const config =
    dashboardWorkspaces.find((workspace) => workspace.key === key) ?? dashboardWorkspaces[0];
  const character = characterById(config.characterId);
  const taskMatcher: Record<DashboardWorkspaceKey, (task: Task) => boolean> = {
    command: () => true,
    capital: (task) => task.hub === "source",
    deals: (task) => task.hub === "source" || task.hub === "run",
    "fund-room": (task) => task.hub === "build" || task.hub === "execute",
    "investor-relations": (task) => task.hub === "execute",
    automation: (task) => Boolean(task.automation_id),
    marketing: (task) => task.hub === "build",
    arcade: () => true,
  };

  return {
    ...config,
    character,
    metrics: data.metrics,
    tasks: data.tasks.filter(taskMatcher[key]).slice(0, 5),
    activities: data.activities,
  };
}

export function dashboardCharacterRoster() {
  return executiveCharacters;
}
