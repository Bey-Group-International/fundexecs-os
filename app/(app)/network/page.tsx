import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NetworkModule } from "@/components/source/NetworkModule";
import { loadActiveNetwork, loadNetworkActivity, loadNetworkLiveCounts } from "@/lib/network-active";

export const metadata: Metadata = {
  title: "Network · FundExecs OS",
  description:
    "Your active network in real time — relationship capital ranked by warmth, a live activity feed, warm introductions, and syndicate circles.",
};

export const dynamic = "force-dynamic";

// Network OS — a standalone, side-rail destination. The default view is the
// operator's ACTIVE NETWORK, assembled from first-party Source-hub data (the
// capital pipeline, relationship contacts, partners, providers) rather than an
// imported address book, alongside a live activity feed. Loads the roster,
// pulse, initial feed + live counts, active circles, and the signed-in
// principal's identity so warm-intro drafts are attributed correctly.
export default async function NetworkPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  // syndicate_circles is not in the generated database types; the loose client
  // mirrors how the rest of the Network OS reads these newer tables.
  const looseDb = supabase as any;
  const orgId = ctx.orgId;

  const [{ people, pulse }, activityEvents, liveCounts, circlesRes, principalRes] = await Promise.all([
    loadActiveNetwork(supabase, orgId),
    loadNetworkActivity(supabase, orgId, 40),
    loadNetworkLiveCounts(supabase, orgId),
    looseDb
      .from("syndicate_circles")
      .select("id, name, description, member_count, invite_code, is_active, created_at")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("principals")
      .select("full_name, title")
      .eq("id", ctx.userId)
      .limit(1)
      .single(),
  ]);

  type CircleRow = {
    id: string;
    name: string;
    description: string | null;
    member_count: number | null;
    invite_code: string | null;
    is_active: boolean | null;
    created_at: string;
  };
  const circles = ((circlesRes.data ?? []) as CircleRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    memberCount: c.member_count ?? 1,
    inviteCode: c.invite_code ?? "",
    isActive: c.is_active ?? true,
    createdAt: c.created_at,
  }));

  const principal = principalRes.data as { full_name: string | null; title: string | null } | null;
  const senderName = principal?.full_name ?? ctx.email ?? "You";
  const senderTitle = principal?.title ?? null;

  return (
    <div className="fx-ambient mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 animate-fade-up">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(212,175,106,0.6)]" />
          Network OS
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Your Active Network
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-secondary">
          Relationship capital ranked by warmth and streaming in real time — populated from your
          Source pipeline, not an imported address book. Request warm introductions and pool your
          network with trusted syndicate partners.
        </p>
      </header>

      <NetworkModule
        senderName={senderName}
        senderTitle={senderTitle}
        people={people}
        pulse={pulse}
        activityEvents={activityEvents}
        liveCounts={liveCounts}
        circles={circles}
      />
    </div>
  );
}
