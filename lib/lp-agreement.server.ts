// lib/lp-agreement.server.ts
//
// An LP's subscription agreement as an envelope: building the per-LP agreement, and
// what the signing steps change around it (the LP's onboarding step, the audit log,
// the investor's CRM timeline). The signing itself is the shared envelope flow.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subscriptionAgreementText } from "@/lib/lp-subscription";
import { recordAudit } from "@/lib/lp-audit.server";
import { normalizeEmail } from "@/lib/crm/contact-match";
import type { SignaturePageSpec } from "@/lib/signing/executed-pdf.server";

type Client = SupabaseClient;

export interface AgreementFacts {
  id: string;
  organization_id: string;
  lp_name: string;
  lp_email: string;
  status: string;
  review_state: string;
  fund_id: string | null;
  investor_id: string | null;
  commitment_amount: number | null;
  orgName: string;
  fundName: string;
  jurisdiction: string;
}

/** The onboarding session and the names the agreement is filled with. */
export async function loadAgreementFacts(client: Client, sessionId: string, orgId?: string): Promise<AgreementFacts | null> {
  let q = client
    .from("lp_onboarding_sessions")
    .select("id, organization_id, lp_name, lp_email, status, review_state, fund_id, investor_id, commitment_amount")
    .eq("id", sessionId);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q.maybeSingle();
  const s = data as Omit<AgreementFacts, "orgName" | "fundName" | "jurisdiction"> | null;
  if (!s) return null;
  const [{ data: org }, { data: fund }] = await Promise.all([
    client.from("organizations").select("name, jurisdiction").eq("id", s.organization_id).maybeSingle(),
    s.fund_id ? client.from("funds").select("name").eq("id", s.fund_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const o = org as { name?: string; jurisdiction?: string | null } | null;
  return {
    ...s,
    orgName: o?.name ?? "the fund manager",
    fundName: (fund as { name?: string } | null)?.name ?? "the fund",
    jurisdiction: o?.jurisdiction ?? "Delaware",
  };
}

export function agreementText(f: AgreementFacts, now: Date = new Date()): string {
  return subscriptionAgreementText(
    { fundName: f.fundName, orgName: f.orgName, jurisdiction: f.jurisdiction, investorName: f.lp_name, commitmentAmount: f.commitment_amount },
    now,
  );
}

/** Where the owner will put blocks: the investor's lines, then the fund's. */
export const AGREEMENT_SIGNATURE_PAGE: SignaturePageSpec = {
  parties: [
    { label: "Investor", lines: ["Signature", "Name", "Title (if signing for an entity)", "Company", "Address", "Date and time"] },
    { label: "Fund", lines: ["Signature", "Name", "Title", "Date and time"] },
  ],
};

/** An LP may be sent an agreement once approved, before they have signed one. */
export function readyForAgreement(f: Pick<AgreementFacts, "status" | "review_state">): boolean {
  return f.review_state === "approved" && f.status === "accreditation";
}

/** The LP has signed their agreement: move them to the next onboarding step. */
export async function onLpAgreementSigned(client: Client, sessionId: string): Promise<void> {
  const f = await loadAgreementFacts(client, sessionId);
  if (!f) return;
  if (f.status === "accreditation") {
    await client
      .from("lp_onboarding_sessions")
      .update({ status: "subscription", subscription_signed_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("status", "accreditation");
  }
  await recordAudit(client, { orgId: f.organization_id, sessionId, action: "subscription.signed", actorKind: "lp" });
  await crmEntry(client, f, "inbound", `Signed subscription agreement (${f.fundName})`);
}

/** The fund has countersigned: the agreement is executed. */
export async function onLpAgreementCountersigned(client: Client, sessionId: string, userId: string): Promise<void> {
  const f = await loadAgreementFacts(client, sessionId);
  if (!f) return;
  await recordAudit(client, { orgId: f.organization_id, sessionId, action: "subscription.countersigned", actorKind: "user", actorId: userId });
  await crmEntry(client, f, "outbound", `Countersigned subscription agreement (${f.fundName})`);
}

// The investor's CRM timeline, on an exact email match only (the CRM's own rule).
async function crmEntry(client: Client, f: AgreementFacts, direction: "inbound" | "outbound", subject: string) {
  try {
    const { crmMatches } = await import("@/lib/data-room-crm.server");
    const matches = await crmMatches(client as never, f.organization_id, [f.lp_email]);
    const m = matches.get(normalizeEmail(f.lp_email));
    if (!m?.contactId) return;
    await client.from("network_activities").insert({
      organization_id: f.organization_id,
      contact_id: m.contactId,
      investor_id: m.investorId ?? f.investor_id,
      activity_type: "document",
      direction,
      subject,
      body: `${subject}.`,
      occurred_at: new Date().toISOString(),
      is_system: true,
      metadata: { source: "lp_subscription_agreement", session_id: f.id },
    });
  } catch {
    // The timeline is a convenience; the signature stands without it.
  }
}

/**
 * The closing gate: an LP's commitment and wire details wait for the fund's countersignature.
 * True once the agreement is fully signed, or when no agreement envelope exists at all
 * (LPs who signed before the shared flow existed keep their path). A voided envelope does
 * not count as one.
 */
export async function agreementExecuted(client: Client, sessionId: string): Promise<boolean> {
  const { data, error } = await client
    .from("envelopes")
    .select("status")
    .eq("lp_session_id", sessionId)
    .neq("status", "voided");
  // Unreadable is not executed: fail closed so wire details never leak on an error.
  if (error) return false;
  const rows = (data ?? []) as { status: string }[];
  return rows.length === 0 || rows.every((r) => r.status === "completed");
}

// ─── What the LP sees in their portal ────────────────────────────────────────

export interface LpAgreementBlock {
  id: string;
  type: string;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required: boolean;
  prefill: string | null;
  locked: boolean;
}

export type LpAgreementView =
  /** The fund has not sent it yet. */
  | { state: "preparing" }
  /** Ready to sign: the LP's own signing link and blocks. */
  | { state: "ready"; title: string; signingToken: string; blocks: LpAgreementBlock[] }
  /** The LP has signed; the fund has yet to countersign. */
  | { state: "signed" }
  /** Fully signed: the executed copy. */
  | { state: "completed"; copyUrl: string };

/** The state of an LP's agreement, read with the service role for the portal. */
export async function loadLpAgreementView(client: Client, sessionId: string): Promise<LpAgreementView> {
  const { data: env } = await client
    .from("envelopes")
    .select("id, title, status")
    .eq("lp_session_id", sessionId)
    .neq("status", "voided")
    .maybeSingle();
  const e = env as { id: string; title: string; status: string } | null;
  if (!e || e.status === "draft") return { state: "preparing" };

  const { data: rec } = await client
    .from("envelope_recipients")
    .select("id, status, signing_token")
    .eq("envelope_id", e.id)
    .eq("role", "signer")
    .maybeSingle();
  const r = rec as { id: string; status: string; signing_token: string } | null;
  if (!r) return { state: "preparing" };

  if (e.status === "completed") {
    const { envelopeCopyUrl } = await import("@/lib/envelope-notify.server");
    return { state: "completed", copyUrl: envelopeCopyUrl(e.id) };
  }
  if (r.status === "signed") return { state: "signed" };

  const { data: flds } = await client
    .from("envelope_fields")
    .select("id, field_type, page, x_pct, y_pct, width_pct, height_pct, required, prefill, locked")
    .eq("recipient_id", r.id);
  const blocks = ((flds ?? []) as { id: string; field_type: string; page: number; x_pct: number; y_pct: number; width_pct: number; height_pct: number; required: boolean; prefill: string | null; locked: boolean }[]).map((f) => ({
    id: f.id, type: f.field_type, page: f.page, xPct: f.x_pct, yPct: f.y_pct, widthPct: f.width_pct, heightPct: f.height_pct,
    required: f.required, prefill: f.prefill, locked: f.locked,
  }));
  return { state: "ready", title: e.title, signingToken: r.signing_token, blocks };
}
