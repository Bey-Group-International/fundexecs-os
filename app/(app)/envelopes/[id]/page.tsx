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

export default async function EnvelopeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();

  // Fetch envelope, recipients, and events in parallel. All queries are
  // best-effort — if the table hasn't migrated yet we fall through to notFound.
  const [envRes, recipRes, eventsRes] = await Promise.all([
    (supabase as ReturnType<typeof createServerClient> & {
      from(t: string): any;
    })
      .from("signing_envelopes")
      .select("*")
      .eq("id", params.id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle(),
    (supabase as ReturnType<typeof createServerClient> & {
      from(t: string): any;
    })
      .from("signing_recipients")
      .select("*")
      .eq("envelope_id", params.id)
      .order("routing_order", { ascending: true }),
    (supabase as ReturnType<typeof createServerClient> & {
      from(t: string): any;
    })
      .from("signing_events")
      .select("*")
      .eq("envelope_id", params.id)
      .order("created_at", { ascending: true }),
  ]);

  const envelope = envRes.data as EnvelopeRow | null;
  if (!envelope) notFound();

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
