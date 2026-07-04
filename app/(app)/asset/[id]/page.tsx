import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getAssetWarRoom } from "@/lib/execute-war-room";
import { AssetWarRoom } from "@/components/execute/AssetWarRoom";

export const dynamic = "force-dynamic";

// Per-asset war room: one portfolio holding's whole operating record — its
// lifecycle stage, the value story (basis vs mark, unrealized gain, gross MOIC,
// operating yield), the source deal and fund it came from, the capital that has
// flowed around it, and the next best operating moves — on one page.
export default async function AssetPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const data = await getAssetWarRoom(ctx.orgId, params.id);
  if (!data) notFound();

  return <AssetWarRoom data={data} />;
}
