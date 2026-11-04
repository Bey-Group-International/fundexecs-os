import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { EnvelopeRow, RecipientRow } from "@/lib/signing";
import { canAdminOrg } from "@/lib/rbac";
import { wizardStep } from "@/lib/signing/wizard";
import { loadCountersign } from "@/lib/envelope-countersign.server";
import { SigningProgress } from "@/components/signing/SigningProgress";
import { EnvelopeDetail } from "./EnvelopeDetail";
import { WaitingActions } from "./WaitingActions";
import { BlockPlacer } from "./place/BlockPlacer";
import { Countersign } from "./countersign/Countersign";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Envelope — FundExecs OS",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvelopeEvent {
  id: string;
  envelope_id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function EnvelopeDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();

  // Fetch envelope, recipients, and events in parallel. All queries are
  // best-effort — if the table hasn't migrated yet we fall through to notFound.
  const [envRes, recipRes, eventsRes] = await Promise.all([
    (supabase as Awaited<ReturnType<typeof createServerClient>> & {
      from(t: string): any;
    })
      .from("envelopes")
      .select("*")
      .eq("id", params.id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle(),
    (supabase as Awaited<ReturnType<typeof createServerClient>> & {
      from(t: string): any;
    })
      .from("envelope_recipients")
      .select("*")
      .eq("envelope_id", params.id)
      .order("routing_order", { ascending: true }),
    (supabase as Awaited<ReturnType<typeof createServerClient>> & {
      from(t: string): any;
    })
      .from("envelope_events")
      .select("*")
      .eq("envelope_id", params.id)
      .order("created_at", { ascending: true }),
  ]);

  const envelope = envRes.data as EnvelopeRow | null;
  if (!envelope) notFound();

  // The countersigner is shown last, labelled as you, not by the placeholder email address.
  const recipients = (recipRes.data ?? []) as RecipientRow[];
  const events = (eventsRes.data ?? []) as EnvelopeEvent[];

  // The three steps on one page: the maker places blocks, the reader signs, the maker countersigns.
  const step = wizardStep(envelope.status);
  const hasPdf = Boolean((envelope as EnvelopeRow & { pdf_storage_key?: string | null }).pdf_storage_key);
  const readerRow = recipients.find((r) => (r as RecipientRow & { role?: string }).role !== "owner");
  const reader = readerRow?.name;
  // An LP signs inside their portal, behind its emailed-code check, so no bare link is offered for it.
  const isLp = Boolean((envelope as EnvelopeRow & { lp_session_id?: string | null }).lp_session_id);
  const shell = (width: string, note?: string) =>
    step ? (
      <div className={`mx-auto ${width} px-4 pt-6`}>
        <SigningProgress current={step} readerName={reader} note={note} />
      </div>
    ) : null;

  // Step 1: place the blocks on the real document, then send.
  if (step === 1 && hasPdf) {
    return (
      <>
        {shell("max-w-4xl")}
        <BlockPlacer
          title={envelope.title}
          fieldsUrl={`/api/envelopes/${envelope.id}/fields`}
          pdfUrl={`/api/envelopes/${envelope.id}/pdf`}
          sendUrl={`/api/envelopes/${envelope.id}/send`}
          doneHref={`/envelopes/${envelope.id}`}
        />
      </>
    );
  }

  // Step 3: the reader has signed; it is the maker's turn.
  if (step === 3 && hasPdf && canAdminOrg(ctx.role)) {
    const cs = await loadCountersign(supabase, envelope.id);
    if (cs) {
      return (
        <>
          {shell("max-w-5xl")}
          <Countersign envelopeId={envelope.id} title={envelope.title} defaultName={cs.defaultName} blocks={cs.blocks} done={cs.done} userId={ctx.userId} />
        </>
      );
    }
  }

  const note =
    step === 2
      ? `Waiting for ${reader ?? "the reader"} to sign. They were emailed their link (you can copy it below), and you are emailed the moment they have.`
      : step === 3
        ? "The reader has signed. An owner or admin countersigns next."
        : undefined;
  return (
    <>
      {shell("max-w-5xl", note)}
      {step === 2 && readerRow ? (
        <div className="mx-auto max-w-5xl px-4">
          <WaitingActions envelopeId={envelope.id} readerName={readerRow.name} signingToken={isLp ? null : readerRow.signing_token} />
        </div>
      ) : null}
      <EnvelopeDetail envelope={envelope} recipients={recipients} events={events} />
    </>
  );
}
