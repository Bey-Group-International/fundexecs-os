import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadContactRecord, loadPrincipalNames } from "@/lib/network-contact";
import { recordNetworkAudit } from "@/lib/network-audit";
import { ContactRecordView } from "@/components/source/ContactRecordView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { title: "Contact · FundExecs OS" };
  const supabase = (await createServerClient()) as any;
  const { data } = await supabase
    .from("network_contacts")
    .select("full_name, company")
    .eq("organization_id", ctx.orgId)
    .eq("id", (await params).id)
    .maybeSingle();
  if (!data) return { title: "Contact · FundExecs OS" };
  return {
    title: `${data.full_name ?? "Contact"} · Network · FundExecs OS`,
    description: [data.full_name, data.company].filter(Boolean).join(" · "),
  };
}

// The relationship record — one person, and everything the firm knows about
// them: identity, where they sit in the capital-formation cycle, who owns the
// relationship, what has actually happened with them, and what is owed next.
//
// Opening a record is itself audited. Access to an institution's relationship
// book is the thing a compliance review asks about, and a view that leaves no
// trace cannot be reviewed.
export default async function ContactPage({ params }: Props) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const { id } = await params;
  const supabase = (await createServerClient()) as any;

  const [view, names] = await Promise.all([
    loadContactRecord(supabase, ctx.orgId, id),
    loadPrincipalNames(supabase, ctx.orgId),
  ]);

  // A contact the caller cannot see and one that does not exist are the same
  // 404 on purpose: a private relationship must not be discoverable by probing.
  if (!view) notFound();

  await recordNetworkAudit(supabase, {
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "view",
    entityId: id,
    entityLabel: view.contact.fullName,
  });

  const owners = [...names.entries()]
    .map(([principalId, name]) => ({ id: principalId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="fx-ambient mx-auto max-w-5xl px-4 py-6">
      <nav className="mb-4 flex items-center gap-2 text-xs text-fg-muted">
        <Link href="/network" className="transition hover:text-fg-primary">
          Network
        </Link>
        <span aria-hidden>/</span>
        <span className="text-fg-secondary">{view.contact.fullName}</span>
      </nav>

      <ContactRecordView
        initial={view}
        owners={owners}
        currentUserId={ctx.userId}
        canDelete={ctx.role === "owner" || ctx.role === "admin"}
      />
    </div>
  );
}
