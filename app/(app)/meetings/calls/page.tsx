import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadCallPage, loadCallStats, type CallPage } from "@/lib/meetings/call-archive.server";
import { CallArchive } from "./CallArchive";

export const dynamic = "force-dynamic";

/**
 * The recorded-call archive.
 *
 * The first page is rendered on the server so the list is there on arrival;
 * searching, narrowing and loading older calls are requests, because they read
 * further than the first page and transcripts do not belong in it. The query is
 * shared with the route — see call-archive.server.ts.
 */
export default async function CallsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const owner = { userId: ctx.userId, orgId: ctx.orgId };
  const empty: CallPage = { calls: [], scanned: 0, bounded: false, hasMore: false };
  const [page, stats] = await Promise.all([
    loadCallPage(supabase, owner).catch(() => empty),
    loadCallStats(supabase, owner),
  ]);

  return <CallArchive initial={page.calls} initialHasMore={page.hasMore} stats={stats} />;
}
