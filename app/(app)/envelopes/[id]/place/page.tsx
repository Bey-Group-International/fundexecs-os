import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { BlockPlacer } from "./BlockPlacer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Place signature blocks — FundExecs OS" };

export default async function PlaceBlocksPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const { data } = await supabase.from("envelopes").select("id, title, status, pdf_storage_key").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle();
  const env = data as { id: string; title: string; status: string; pdf_storage_key: string | null } | null;
  if (!env) notFound();
  // Blocks are placed before sending; after that the document is read-only.
  if (env.status !== "draft" || !env.pdf_storage_key) redirect(`/envelopes/${id}`);
  return <BlockPlacer envelopeId={env.id} title={env.title} />;
}
