import { collection, failure, withApiKey } from "@/lib/api-v1";
import { clampLimit, decodeCursor, encodeCursor, pgLiteral } from "@/lib/api-v1-cursor";
import type { Fund } from "@/lib/supabase/database.types";

// GET /api/v1/funds — the authenticated org's funds.
//
//   curl https://app.fundexecs.com/api/v1/funds \
//     -H "Authorization: Bearer fxsk_live_…"
//
// Paginated: pass ?limit=N (default 50, max 200) and follow the response's
// nextCursor (?cursor=<token>) to page through further results.
export const dynamic = "force-dynamic";

type FundRow = Pick<
  Fund,
  | "id"
  | "name"
  | "fund_type"
  | "vintage_year"
  | "target_size"
  | "committed_capital"
  | "called_capital"
  | "distributed_capital"
  | "currency"
>;

export const GET = withApiKey(async ({ orgId, supabase }, request) => {
  const { searchParams } = new URL(request.url);
  const limit = clampLimit(searchParams.get("limit"));
  const cursorParam = searchParams.get("cursor");

  let query = supabase
    .from("funds")
    .select(
      "id, name, fund_type, vintage_year, target_size, committed_capital, called_capital, distributed_capital, currency",
    )
    .eq("organization_id", orgId)
    .order("vintage_year", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit + 1); // fetch one extra to detect whether a next page exists

  if (cursorParam) {
    const cursor = decodeCursor(cursorParam);
    if (!cursor) return failure("Invalid cursor", 400);
    if (cursor.v === null) {
      // vintage_year is nullable and sorts last (nullsFirst: false); a null
      // cursor means the previous page already reached that tail, so the
      // next page is purely "more nulls, in id order" — a plain AND, not an
      // .or() alternation.
      query = query.is("vintage_year", null).lt("id", cursor.id);
    } else {
      // Rows strictly "after" the cursor in (vintage_year desc, id desc)
      // order, PLUS every null-vintage_year row — those all sort after any
      // non-null value under nulls-last ordering.
      query = query.or(
        `vintage_year.lt.${pgLiteral(cursor.v)},and(vintage_year.eq.${pgLiteral(cursor.v)},id.lt.${pgLiteral(cursor.id)}),vintage_year.is.null`,
      );
    }
  }

  const { data, error } = await query;
  if (error) return failure(error.message, 500);

  const rows = (data as FundRow[] | null) ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ v: last.vintage_year === null ? null : String(last.vintage_year), id: last.id })
      : null;

  const funds = page.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.fund_type,
    vintage_year: f.vintage_year,
    target_size: f.target_size,
    committed_capital: f.committed_capital,
    called_capital: f.called_capital,
    distributed_capital: f.distributed_capital,
    currency: f.currency,
  }));

  return collection(funds, nextCursor);
}, "read:funds");
