import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { encodeCursor, decodeCursor } from "@/lib/task-cursor";

// GET /api/task — list workflows (top-level tasks) for the active org.
// Supports cursor-based pagination: pass ?cursor=<opaque token> to get the
// next page. Default page size is 25; pass ?limit=N (max 100) to override.
// Response includes nextCursor when more pages exist. The cursor is a keyset
// on (created_at, id) — see lib/task-cursor.ts.
export async function GET(req: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limitParam = parseInt(searchParams.get("limit") ?? "25", 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 25 : limitParam), 100);

  const supabase = createServerClient();
  let query = supabase
    .from("tasks")
    .select("*")
    .eq("organization_id", auth.ctx.orgId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1); // fetch one extra to detect whether a next page exists

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (!decoded) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    // Rows strictly "after" the cursor in (created_at desc, id desc) order.
    query = query.or(
      `created_at.lt.${decoded.createdAt},and(created_at.eq.${decoded.createdAt},id.lt.${decoded.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const hasMore = (data?.length ?? 0) > limit;
  const workflows = hasMore ? data!.slice(0, limit) : (data ?? []);
  const last = workflows[workflows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

  return NextResponse.json({ workflows, nextCursor });
}
