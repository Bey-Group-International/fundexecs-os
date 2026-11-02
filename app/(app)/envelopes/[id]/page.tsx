import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { EnvelopeRow, RecipientRow } from "@/lib/signing";
import { EnvelopeDetail } from "./EnvelopeDetail";

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

  return (
    <EnvelopeDetail
      envelope={envelope}
      recipients={recipients}
      events={events}
    />
  );
}
