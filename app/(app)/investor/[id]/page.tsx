import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getInvestorWarRoom } from "@/lib/source-war-room";
import { InvestorWarRoom } from "@/components/source/InvestorWarRoom";
import { MobileContactActionBar } from "@/components/mobile/MobileContactActionBar";

export const dynamic = "force-dynamic";

// Per-LP war room: one investor's whole relationship — temperature and thesis
// fit, every commitment with called/distributed progress, the capital flows
// tied to them, the next best moves, and the warm intro path — on one page.
export default async function InvestorPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const data = await getInvestorWarRoom(ctx.orgId, params.id);
  if (!data) notFound();

  return (
    <>
      <InvestorWarRoom data={data} />
      {/* Thumb-reachable LP actions on mobile; the spacer keeps the last of the
          war room clear of the fixed bar. Desktop is unaffected. */}
      <div className="h-16 md:hidden" aria-hidden />
      <MobileContactActionBar
        name={data.investor.contact_name || data.investor.name}
        email={data.investor.contact_email}
        phone={data.investor.contact_phone}
      />
    </>
  );
}
