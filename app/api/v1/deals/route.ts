import { collection, failure, withApiKey } from "@/lib/api-v1";
import { clampLimit, decodeCursor, encodeCursor, pgLiteral } from "@/lib/api-v1-cursor";
import type { Deal } from "@/lib/supabase/database.types";

// GET /api/v1/deals — the authenticated org's deals (most recently updated first).
//
//   curl https://app.fundexecs.com/api/v1/deals \
//     -H "Authorization: Bearer fxsk_live_…"
//
// Scoped strictly to the key's organization_id. Curated pipeline fields only —
// free-text notes and internal session links are not exposed.
//
// Paginated: pass ?limit=N (default 50, max 200) and follow the response's
// nextCursor (?cursor=<token>) to page through orgs with large pipelines
// instead of the whole table coming back in one response.
export const dynamic = "force-dynamic";

type DealRow = Pick<
  Deal,
  "id" | "name" | "stage" | "asset_class" | "geography" | "target_amount" | "expected_close" | "updated_at"
>;

export const GET = withApiKey(async ({ orgId, supabase }, request) => {
  const { searchParams } = new URL(request.url);
  const limit = clampLimit(searchParams.get("limit"));
  const cursorParam = searchParams.get("cursor");

  let query = supabase
    .from("deals")
    .select("id, name, stage, asset_class, geography, target_amount, expected_close, updated_at")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1); // fetch one extra to detect whether a next page exists

  if (cursorParam) {
    const cursor = decodeCursor(cursorParam);
    if (!cursor || cursor.v === null) return failure("Invalid cursor", 400);
    query = query.or(
      `updated_at.lt.${pgLiteral(cursor.v)},and(updated_at.eq.${pgLiteral(cursor.v)},id.lt.${pgLiteral(cursor.id)})`,
    );
  }

  const { data, error } = await query;
  if (error) return failure(error.message, 500);

  const rows = (data as DealRow[] | null) ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ v: last.updated_at, id: last.id }) : null;

  const deals = page.map((d) => ({
    id: d.id,
    name: d.name,
    stage: d.stage,
    asset_class: d.asset_class,
    geography: d.geography,
    target_amount: d.target_amount,
    expected_close: d.expected_close,
    updated_at: d.updated_at,
  }));

  return collection(deals, nextCursor);
});
