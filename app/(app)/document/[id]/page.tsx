import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { DocumentBuilder } from "@/components/build/DocumentBuilder";
import type { Document } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const SECTION_LABEL = new Map(DATA_ROOM_SECTIONS.map((s) => [s.key, s.label]));

// Document builder: manual editing, parse/compose-from-data, or Earn chat.
// Reached by clicking a file in the Materials & Data Room.
export default async function DocumentBuilderPage({ params }: { params: { id: string } }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const doc = data as Document | null;
  if (!doc) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5">
        <Link
          href="/build/data_room"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400 hover:underline"
        >
          ← Materials &amp; Data Room
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg-primary">{doc.name}</h1>
        <p className="mt-0.5 text-sm text-fg-secondary">
          {SECTION_LABEL.get(doc.doc_type ?? "other") ?? "Document"} · build it manually, parse from your data, or draft with Earn.
        </p>
      </header>
      <DocumentBuilder
        doc={{ id: doc.id, name: doc.name, doc_type: doc.doc_type, content: doc.content, storage_key: doc.storage_key }}
      />
    </div>
  );
}
