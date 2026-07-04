import { accepted, collection, failure, withApiKey } from "@/lib/api-v1";
import { clampLimit, decodeCursor, encodeCursor, pgLiteral } from "@/lib/api-v1-cursor";
import { createApiWriteApproval, parseApiWrite } from "@/lib/api-write-requests";
import type { Investor } from "@/lib/supabase/database.types";

// GET /api/v1/investors — the authenticated org's investor CRM records.
//
//   curl https://app.fundexecs.com/api/v1/investors \
//     -H "Authorization: Bearer fxsk_live_…"
//
// Scoped strictly to the key's organization_id. Curated fields only — free-text
// notes are not exposed over the API.
//
// Paginated: pass ?limit=N (default 50, max 200) and follow the response's
// nextCursor (?cursor=<token>) to page through orgs with large investor books
// instead of the whole table coming back in one response.
export const dynamic = "force-dynamic";

type InvestorRow = Pick<
  Investor,
  "id" | "name" | "investor_type" | "pipeline_stage" | "jurisdiction" | "typical_check_min" | "typical_check_max"
>;

export const GET = withApiKey(async ({ orgId, supabase }, request) => {
  const { searchParams } = new URL(request.url);
  const limit = clampLimit(searchParams.get("limit"));
  const cursorParam = searchParams.get("cursor");

  let query = supabase
    .from("investors")
    .select("id, name, investor_type, pipeline_stage, jurisdiction, typical_check_min, typical_check_max")
    .eq("organization_id", orgId)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1); // fetch one extra to detect whether a next page exists

  if (cursorParam) {
    const cursor = decodeCursor(cursorParam);
    if (!cursor || cursor.v === null) return failure("Invalid cursor", 400);
    query = query.or(
      `name.gt.${pgLiteral(cursor.v)},and(name.eq.${pgLiteral(cursor.v)},id.gt.${pgLiteral(cursor.id)})`,
    );
  }

  const { data, error } = await query;
  if (error) return failure(error.message, 500);

  const rows = (data as InvestorRow[] | null) ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ v: last.name, id: last.id }) : null;

  const investors = page.map((i) => ({
    id: i.id,
    name: i.name,
    type: i.investor_type,
    pipeline_stage: i.pipeline_stage,
    jurisdiction: i.jurisdiction,
    typical_check_min: i.typical_check_min,
    typical_check_max: i.typical_check_max,
  }));

  return collection(investors, nextCursor);
}, "read:investors");

// POST /api/v1/investors — propose an investor (writes-as-approvals; scope
// write:investors).
//
//   curl -X POST https://app.fundexecs.com/api/v1/investors \
//     -H "Authorization: Bearer fxsk_live_…" -H "Content-Type: application/json" \
//     -d '{"name": "Meridian Family Office", "investor_type": "family_office"}'
//
// Nothing is committed here: the validated row parks as a task + approval pair
// that an operator decides in the app (the Tier model — external writes never
// bypass the human). Responds 202 with the approval handle.
export const POST = withApiKey(async ({ orgId, keyId, mode, supabase }, request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("Request body must be JSON", 400);
  }
  const parsed = parseApiWrite("investors", body);
  if (!parsed.ok) return failure(parsed.error, 422);

  const queued = await createApiWriteApproval(supabase, {
    orgId,
    keyId,
    mode,
    resource: "investors",
    row: parsed.row,
  });
  if (!queued.ok) return failure(queued.error, 500);

  return accepted({
    resource: "investors",
    status: "pending_approval",
    approval_id: queued.approvalId,
    task_id: queued.taskId,
  });
}, "write:investors");
