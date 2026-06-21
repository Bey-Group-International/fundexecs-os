import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getInvestorRoom } from "@/lib/investor-room";
import { InvestorRoom } from "@/components/run/InvestorRoom";

export const dynamic = "force-dynamic";

// The gated Investor Room for a deal: permissioned material cards plus the
// compliance posture that must hold before anything is shared externally. The
// internal (authed) operator view of what an investor would be permissioned to
// see — distinct from the public, tokenized data room.
export default async function InvestorRoomPage({ params }: { params: { id: string } }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const data = await getInvestorRoom(ctx.orgId, params.id);
  if (!data) notFound();

  return <InvestorRoom data={data} />;
}
