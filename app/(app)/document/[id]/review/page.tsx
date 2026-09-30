import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canWriteOrg } from "@/lib/rbac";
import { createServerClient } from "@/lib/supabase/server";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { documentKindLabel, formatBytes, isUploadedFile, previewKindFor } from "@/lib/document-files";
import { suggestShareSettings } from "@/lib/document-review";
import { shareUrl } from "@/lib/data-room-shares.server";
import { DocumentReviewWorkspace } from "@/components/documents/DocumentReviewWorkspace";
import type { DataRoomShare, Document, DocumentReview } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const SECTION_LABEL = new Map(DATA_ROOM_SECTIONS.map((s) => [s.key, s.label]));

// An uploaded document, as-is, beside Earn's read of it.
//
// This is where an upload lands when the operator clicks through: the file
// rendered in the page (no new tab, no download), Earn's recommended
// adjustments, the one-click accept that marks it Ready, and a single-document
// preview link to send. Written documents have the editor instead, so they are
// redirected there.
export default async function DocumentReviewPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const doc = data as Document | null;
  if (!doc) notFound();
  if (!isUploadedFile(doc.storage_key)) redirect(`/document/${doc.id}`);

  const [reviewRes, sharesRes] = await Promise.all([
    supabase
      .from("document_reviews")
      .select("*")
      .eq("document_id", doc.id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle(),
    supabase
      .from("data_room_shares")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .eq("document_id", doc.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  ]);
  const cached = reviewRes.data as DocumentReview | null;
  // A review of a previous version is not a review of this one.
  const review = cached && cached.storage_key === doc.storage_key ? cached : null;
  const now = Date.now();
  const links = ((sharesRes.data ?? []) as DataRoomShare[])
    .filter((s) => !s.expires_at || new Date(s.expires_at).getTime() > now)
    .map((s) => ({
      id: s.id,
      label: s.label,
      url: shareUrl(s.token),
      expiresAt: s.expires_at,
      allowDownload: s.allow_download ?? true,
      watermark: s.watermark ?? false,
      requireNda: s.require_nda ?? false,
    }));

  const section = doc.doc_type ?? "other";

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-5">
        <Link
          href="/build/documents"
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300 hover:underline"
        >
          ← Documents
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg-primary">{doc.name}</h1>
        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          {SECTION_LABEL.get(section) ?? "Other Materials"} · {documentKindLabel(doc.storage_key, false)} ·{" "}
          {formatBytes(doc.size_bytes)}
        </p>
      </header>

      <DocumentReviewWorkspace
        doc={{
          id: doc.id,
          name: doc.name,
          section,
          status: doc.status ?? "draft",
          previewKind: previewKindFor(doc.storage_key),
        }}
        sections={DATA_ROOM_SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
        initialReview={review}
        shareDefaults={suggestShareSettings({ name: doc.name, section })}
        links={links}
        canWrite={canWriteOrg(ctx.role)}
      />
    </div>
  );
}
