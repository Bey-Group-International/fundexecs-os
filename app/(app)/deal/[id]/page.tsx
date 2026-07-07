import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getDealWarRoom } from "@/lib/run-war-room";
import { DealWarRoom } from "@/components/run/DealWarRoom";
import { ShareDealBar } from "@/components/run/ShareDealBar";
import { MobileDealActionBar } from "@/components/mobile/MobileDealActionBar";

export const dynamic = "force-dynamic";

// Per-deal war room: one deal's whole evaluation — conviction + trend,
// underwriting, diligence, risk heatmap, and the IC decision log — on one page.
export default async function DealPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const data = await getDealWarRoom(ctx.orgId, params.id);
  if (!data) notFound();

  return (
    <>
      <ShareDealBar dealId={params.id} />
      <DealWarRoom data={data} />
      {/* Thumb-reachable deal actions on mobile; the spacer keeps the last of
          the war room clear of the fixed bar. Desktop is unaffected. */}
      <div className="h-16 md:hidden" aria-hidden />
      <MobileDealActionBar dealId={params.id} dealName={data.conviction.deal.name} />
    </>
  );
}
