import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { AGENT_BY_KEY } from "@/lib/agents";
import { stageLabel, sectorLabel } from "@/lib/deal-share";
import type { DealStage, AgentKey } from "@/lib/supabase/database.types";
import { MobileCommandCenter, type CommandCenterData } from "@/components/mobile/MobileCommandCenter";

export const metadata: Metadata = {
  title: "Home · FundExecs OS",
  description: "Your executive command center — priorities, approvals, workflows, and deals at a glance.",
};

export const dynamic = "force-dynamic";

const TERMINAL_STAGES = new Set<DealStage>(["exited", "passed", "dead"]);

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function riskForAgent(hub: string | null): "high" | "medium" | "low" {
  // Outward-facing / capital-moving hubs are the sensitive ones.
  if (hub === "execute") return "high";
  if (hub === "run") return "medium";
  return "low";
}

// The Mobile App Home / Command Center. A dedicated, app-native landing surface
// that reuses the platform's existing data + auth. On desktop it renders as a
// focused, centered column inside the standard app chrome; on mobile it is the
// heart of the app shell.
export default async function MobileHomePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const [
    { data: principal },
    { data: dealRows },
    { data: approvalRows },
    { data: workflowRows },
    { count: dealsCount },
    { count: approvalsCount },
    { count: workflowsCount },
    { count: unreadCount },
    { data: activityRows },
  ] = await Promise.all([
    supabase.from("principals").select("full_name").eq("id", ctx.userId).maybeSingle(),
    supabase
      .from("deals")
      .select("id, name, stage, asset_class, geography, target_amount, thesis_fit")
      .eq("organization_id", ctx.orgId)
      .order("updated_at", { ascending: false })
      .limit(12),
    supabase
      .from("tasks")
      .select("id, title, description, assigned_agent, hub, created_at, session_id")
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null)
      .eq("status", "awaiting_approval")
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("tasks")
      .select("id, title, assigned_agent, status, progress, updated_at, session_id")
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null)
      .in("status", ["in_progress", "pending", "blocked"])
      .order("updated_at", { ascending: false })
      .limit(3),
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .not("stage", "in", "(exited,passed,dead)"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null)
      .eq("status", "awaiting_approval"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null)
      .in("status", ["in_progress", "pending", "blocked"]),
    supabase
      .from("inbox_threads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .eq("unread", true)
      .eq("status", "open"),
    supabase
      .from("inbox_threads")
      .select("id, subject, preview, last_message_at")
      .eq("organization_id", ctx.orgId)
      .eq("status", "open")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(4),
  ]);

  const name = principal?.full_name?.trim() || ctx.email.split("@")[0] || "there";
  const now = new Date();

  const deals = ((dealRows ?? []) as {
    id: string;
    name: string;
    stage: DealStage;
    asset_class: string | null;
    geography: string | null;
    target_amount: number | null;
    thesis_fit: number | null;
  }[])
    .filter((d) => !TERMINAL_STAGES.has(d.stage))
    .slice(0, 5)
    .map((d) => ({
      id: d.id,
      name: d.name,
      stage: d.stage,
      stageLabel: stageLabel(d.stage),
      targetAmount: d.target_amount,
      sector: sectorLabel(d.asset_class),
      geography: d.geography,
      thesisFit: d.thesis_fit,
      href: `/deal/${d.id}`,
      nextStep: null as string | null,
    }));

  const approvals = ((approvalRows ?? []) as {
    id: string;
    title: string;
    description: string | null;
    assigned_agent: AgentKey;
    hub: string | null;
    created_at: string;
  }[]).map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.description,
    agentLabel: AGENT_BY_KEY[t.assigned_agent]?.name ?? "Earn",
    risk: riskForAgent(t.hub),
    requestedAt: t.created_at,
    href: "/inbox",
  }));

  const workflows = ((workflowRows ?? []) as {
    id: string;
    title: string;
    assigned_agent: AgentKey;
    status: string;
    progress: number;
    updated_at: string;
    session_id: string | null;
  }[]).map((t) => {
    const agent = AGENT_BY_KEY[t.assigned_agent];
    return {
      id: t.id,
      title: t.title,
      agentLabel: agent?.name ?? "Earn",
      agentColor: agent?.color ?? null,
      status: t.status,
      statusLabel: t.status.replace(/_/g, " "),
      progress: t.progress ?? 0,
      updatedAt: t.updated_at,
      href: t.session_id ? `/session/${t.session_id}` : "/automations",
    };
  });

  const activity = ((activityRows ?? []) as {
    id: string;
    subject: string | null;
    preview: string | null;
    last_message_at: string | null;
  }[])
    .filter((a) => a.subject || a.preview)
    .map((a) => ({
      id: a.id,
      text: a.subject || a.preview || "New activity",
      at: a.last_message_at,
      href: "/inbox",
    }));

  const counts = {
    deals: dealsCount ?? deals.length,
    approvals: approvalsCount ?? approvals.length,
    workflows: workflowsCount ?? workflows.length,
    unread: unreadCount ?? 0,
  };

  // Recommended next action — the single most important thing right now.
  let nextAction: CommandCenterData["nextAction"];
  if (counts.approvals > 0) {
    nextAction = {
      eyebrow: "Needs your sign-off",
      title: `${counts.approvals} approval${counts.approvals === 1 ? "" : "s"} waiting on you`,
      body: "Earn has work ready — review the context and decide.",
      href: "/inbox",
      cta: "Review approvals",
    };
  } else if (counts.workflows > 0) {
    nextAction = {
      eyebrow: "In motion",
      title: `${counts.workflows} workflow${counts.workflows === 1 ? "" : "s"} running`,
      body: "Your executive agents are on the work. Track progress live.",
      href: "/automations",
      cta: "Watch progress",
    };
  } else if (deals.length > 0) {
    nextAction = {
      eyebrow: "Move a deal forward",
      title: `Advance ${deals[0].name}`,
      body: `Currently ${deals[0].stageLabel}. Ask Earn for the next step.`,
      href: `/deal/${deals[0].id}`,
      cta: "Open deal",
    };
  } else {
    nextAction = {
      eyebrow: "Start here",
      title: "Delegate your first task to Earn",
      body: "Source a deal, build your pipeline, or prep investor materials.",
      href: "/earn",
      cta: "Ask Earn",
    };
  }

  const data: CommandCenterData = {
    name,
    greeting: greetingFor(now.getHours()),
    dateLabel: now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
    counts,
    nextAction,
    approvals,
    workflows,
    deals,
    activity,
  };

  return <MobileCommandCenter data={data} />;
}
