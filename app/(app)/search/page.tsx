import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { searchAll } from "@/lib/search";
import { SearchView } from "@/components/search/SearchView";

export const dynamic = "force-dynamic";

// Global search: read ?q=, run the org-scoped search, render the box + grouped
// results. Auth/org guarded like the rest of the authed shell.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string | string[] };
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const raw = searchParams.q;
  const query = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
  const results = await searchAll(ctx.orgId, query);

  return (
    <div className="fx-ambient mx-auto max-w-3xl">
      <ModuleHeader
        title="Search"
        blurb="Find deals, LPs, and assets — jump straight to their war rooms."
      />
      <SearchView results={results} />
    </div>
  );
}
