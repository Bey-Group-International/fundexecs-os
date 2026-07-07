import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NetworkModule } from "@/components/source/NetworkModule";

export const metadata: Metadata = {
  title: "Network · FundExecs OS",
  description:
    "Search your relationship capital, request warm introductions, and pool your network with trusted syndicate partners.",
};

export const dynamic = "force-dynamic";

// Network — a standalone, side-rail destination (formerly Source › Network).
// Relationship-capital search, LinkedIn import, warm intros, and syndicate
// circles. Loads contact counts, active circles, and the signed-in principal's
// name/title so warm-intro drafts are attributed correctly.
export default async function NetworkPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = (await createServerClient()) as any;
  const typedSupabase = await createServerClient();

  const [contactsRes, circlesRes, principalRes] = await Promise.all([
    supabase
      .from("network_contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId),
    supabase
      .from("syndicate_circles")
      .select("id, name, description, member_count, invite_code, is_active, created_at")
      .eq("organization_id", ctx.orgId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    typedSupabase
      .from("principals")
      .select("full_name, title")
      .eq("id", ctx.userId)
      .limit(1)
      .single(),
  ]);

  const contactCount = contactsRes.count ?? 0;
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
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Network OS
        </p>
        <p className="text-sm text-fg-muted">
          Search your relationship capital, request warm introductions, and pool your network with
          trusted syndicate partners.
        </p>
      </div>
      <NetworkModule
        senderName={senderName}
        senderTitle={senderTitle}
        initialContacts={contactCount}
        circles={circles}
      />
    </div>
  );
}
