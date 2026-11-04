import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canAdminOrg } from "@/lib/rbac";
import { createServerClient } from "@/lib/supabase/server";
import { SigningProgress } from "@/components/signing/SigningProgress";
import { BlockPlacer } from "../../../envelopes/[id]/place/BlockPlacer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Signature blocks — FundExecs OS" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The owner opens a data-room file and clicks where the reader signs, and where the fund
// countersigns. Every reader who opens the file is then asked to sign on those blocks.
export default async function RoomSignaturePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ room?: string }>;
}) {
  const { id } = await props.params;
  const { room } = await props.searchParams;
  if (!room || !UUID.test(room) || !UUID.test(id)) notFound();
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");
  if (!canAdminOrg(ctx.role)) redirect("/build/data_room");

  const supabase = await createServerClient();
  const { data: row } = await supabase
    .from("data_room_documents")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("room_id", room)
    .eq("document_id", id)
    .maybeSingle();
  const { data: doc } = await supabase.from("documents").select("name").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle();
  if (!row || !doc) notFound();

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 pt-6">
        <SigningProgress current={1} note="You place the blocks once. Then each reader signs on their own link, and you countersign each one." />
      </div>
      <BlockPlacer
      title={(doc as { name: string }).name}
      fieldsUrl={`/api/data-rooms/${room}/documents/${id}/signature`}
      pdfUrl={`/api/data-rooms/${room}/documents/${id}/pdf`}
      doneHref="/build/data_room"
      prefillNames={false}
      hint="Click where the reader signs, and where you countersign. Every reader who opens this file signs on these blocks."
    />
    </>
  );
}
