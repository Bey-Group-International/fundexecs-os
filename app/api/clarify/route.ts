import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { generateClarifyingQuestions } from "@/lib/claude";
import { CONVERSATIONAL_COST, gateConversationalSpend } from "@/lib/conversational-gate";
import type { Task } from "@/lib/supabase/database.types";

// Generating questions calls Claude; give it a little room.
export const maxDuration = 60;

// POST /api/clarify — Earn asks the operator. Given a workflow, return the
// clarifying questions Earn would want answered before committing to the plan.
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const payload = await request.json().catch(() => null);
  const workflowId = payload?.workflow_id;
  if (!workflowId || typeof workflowId !== "string") {
    return NextResponse.json({ error: "Required: workflow_id" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", workflowId)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  const workflow = data as Task;

  // Pre-flight credit gate. Clarifying questions are a pre-plan nicety, not
  // the plan itself — insufficient credits skips them (the operator proceeds
  // straight to the plan) rather than blocking the whole flow.
  const gate = await gateConversationalSpend(auth.ctx.orgId, CONVERSATIONAL_COST.clarify, "clarify");
  if (!gate.ok) return NextResponse.json({ questions: [] });

  const questions = await generateClarifyingQuestions(workflow.description ?? workflow.title);
  return NextResponse.json({ questions });
}
