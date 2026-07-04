import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { GridWorkflow } from "@/lib/execution-grid";
import { reviewItems } from "@/lib/routing-review";
import { ReviewQueue } from "@/components/grid/ReviewQueue";

export const dynamic = "force-dynamic";

// The Routing Review queue: the org's parent workflows that need a human to
// confirm or fix their route — low-confidence (hub-default) routes and
// escalated workflows (operator_feedback rows with signal "escalate").
export default async function RoutingReviewPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const [{ data: taskData }, { data: feedbackData }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, status, session_id, created_at, hub, description, lifecycle_stage, target_engine")
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("operator_feedback")
      .select("task_id")
      .eq("organization_id", ctx.orgId)
      .eq("signal", "escalate"),
  ]);

  const rows = (taskData ?? []) as GridWorkflow[];
  const escalatedIds = new Set(
    ((feedbackData ?? []) as { task_id: string | null }[])
      .map((r) => r.task_id)
      .filter((id): id is string => !!id),
  );

  const items = reviewItems(rows, escalatedIds);

  return <ReviewQueue items={items} />;
}
