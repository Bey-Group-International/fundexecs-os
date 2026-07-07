import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { AGENT_BY_KEY } from "@/lib/agents";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { AgentKey, Hub, Json } from "@/lib/supabase/database.types";
import { MobileApprovalsFlow, type ApprovalItem } from "@/components/mobile/MobileApprovalsFlow";

export const metadata: Metadata = {
  title: "Approvals · FundExecs OS",
  description: "Review and decide pending approvals — swipe to approve or reject.",
};

export const dynamic = "force-dynamic";

// Outward-facing / capital-moving hubs are the sensitive ones.
function riskForHub(hub: string | null): "high" | "medium" | "low" {
  if (hub === "execute") return "high";
  if (hub === "run") return "medium";
  return "low";
}

// Pull a short human-readable preview out of a task's freeform `result` JSON.
function previewOf(result: Json | null): string | null {
  if (!result) return null;
  if (typeof result === "string") return result.slice(0, 600);
  if (typeof result === "object" && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    for (const key of ["summary", "text", "output", "body", "message", "content", "draft"]) {
      const v = r[key];
      if (typeof v === "string" && v.trim()) return v.slice(0, 600);
    }
  }
  return null;
}

// The mobile Approvals decision flow — a dedicated on-the-go surface for
// clearing sign-offs between meetings. Reuses the same approvals data + engine
// as the desktop inbox; the desktop experience is untouched.
export default async function ApprovalsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();

  const { data: taskRows } = await supabase
    .from("tasks")
    .select("id, title, description, assigned_agent, hub, result, created_at")
    .eq("organization_id", ctx.orgId)
    .is("parent_task_id", null)
    .eq("status", "awaiting_approval")
    .order("created_at", { ascending: false })
    .limit(25);

  const tasks = (taskRows ?? []) as {
    id: string;
    title: string;
    description: string | null;
    assigned_agent: AgentKey;
    hub: Hub | null;
    result: Json | null;
    created_at: string;
  }[];

  // Resolve the still-pending approval id for each awaiting task.
  const taskIds = tasks.map((t) => t.id);
  const approvalByTask = new Map<string, string>();
  if (taskIds.length) {
    const { data: approvals } = await supabase
      .from("approvals")
      .select("id, task_id, decision")
      .in("task_id", taskIds)
      .eq("decision", "pending");
    for (const a of (approvals ?? []) as { id: string; task_id: string; decision: string }[]) {
      if (!approvalByTask.has(a.task_id)) approvalByTask.set(a.task_id, a.id);
    }
  }

  const items: ApprovalItem[] = tasks
    .filter((t) => approvalByTask.has(t.id))
    .map((t) => {
      const agent = AGENT_BY_KEY[t.assigned_agent];
      return {
        approvalId: approvalByTask.get(t.id)!,
        title: t.title,
        description: t.description,
        preview: previewOf(t.result),
        agentLabel: agent?.name ?? "Earn",
        agentColor: agent?.color ?? null,
        risk: riskForHub(t.hub),
        hubLabel: t.hub ? HUB_BY_KEY[t.hub]?.label ?? null : null,
        requestedAt: t.created_at,
      };
    });

  return <MobileApprovalsFlow items={items} />;
}
