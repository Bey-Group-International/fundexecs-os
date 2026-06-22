import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";

// GET /api/task — list workflows (top-level tasks) for the active org.
// Supports cursor-based pagination: pass ?cursor=<created_at ISO> to get the
// next page of tasks older than that timestamp. Default page size is 25;
// pass ?limit=N (max 100) to override. Response includes nextCursor when
// more pages exist.
export async function GET(req: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor") ?? null;
  const limitParam = parseInt(searchParams.get("limit") ?? "25", 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 25 : limitParam), 100);

  const supabase = createServerClient();
  let query = supabase
    .from("tasks")
    .select("*")
    .eq("organization_id", auth.ctx.orgId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(limit + 1); // fetch one extra to detect whether a next page exists

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const hasMore = (data?.length ?? 0) > limit;
  const workflows = hasMore ? data!.slice(0, limit) : (data ?? []);
  const nextCursor = hasMore ? workflows[workflows.length - 1].created_at : null;

  return NextResponse.json({ workflows, nextCursor });
}
