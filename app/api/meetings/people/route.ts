import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadPeopleDirectory } from "@/lib/meetings/people.server";
import { rankSuggestions } from "@/lib/meetings/people";

export const dynamic = "force-dynamic";

/**
 * `GET /api/meetings/people?q=&exclude=a@x,b@y`
 *
 * Who the attendee picker can offer: org teammates, saved network contacts, and
 * people from recent meetings, merged and ranked. Org-scoped through
 * requireOrgContext and read on the caller's own client, so RLS still applies —
 * this endpoint can never widen what the member is allowed to see.
 *
 * Ranking happens in memory rather than in SQL. The candidate set is a few
 * hundred rows at most, one prefix rule has to apply identically across three
 * tables with different shapes, and doing it here keeps the logic pure and
 * tested (lib/meetings/people.ts) instead of spread over three ilike filters.
 */
export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const exclude = (req.nextUrl.searchParams.get("exclude") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const supabase = await createServerClient();
  const people = await loadPeopleDirectory(supabase, auth.ctx.orgId);

  // Wider than the dropdown shows. The picker re-ranks this set locally on every
  // keystroke so the list narrows between debounced fetches; handing it only the
  // eight it can display would leave it nothing to narrow, and the ninth-best
  // match could never appear no matter how much more the member typed.
  return NextResponse.json({ results: rankSuggestions(people, q, exclude, 25) });
}
