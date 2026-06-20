import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getInvestorWarRoom } from "@/lib/source-war-room";
import { InvestorWarRoom } from "@/components/source/InvestorWarRoom";

export const dynamic = "force-dynamic";

// Per-LP war room: one investor's whole relationship — temperature and thesis
// fit, every commitment with called/distributed progress, the capital flows
// tied to them, the next best moves, and the warm intro path — on one page.
export default async function InvestorPage({ params }: { params: { id: string } }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const data = await getInvestorWarRoom(ctx.orgId, params.id);
  if (!data) notFound();

  return <InvestorWarRoom data={data} />;
}
