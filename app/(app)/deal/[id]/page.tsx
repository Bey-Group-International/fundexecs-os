import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getDealWarRoom } from "@/lib/run-war-room";
import { DealWarRoom } from "@/components/run/DealWarRoom";

export const dynamic = "force-dynamic";

// Per-deal war room: one deal's whole evaluation — conviction + trend,
// underwriting, diligence, risk heatmap, and the IC decision log — on one page.
export default async function DealPage({ params }: { params: { id: string } }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const data = await getDealWarRoom(ctx.orgId, params.id);
  if (!data) notFound();

  return <DealWarRoom data={data} />;
}
