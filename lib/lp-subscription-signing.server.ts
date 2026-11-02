// lib/lp-subscription-signing.server.ts
//
// Signing a subscription agreement, LP first and then the fund. The server
// decides everything the record says: the time (its clock), who signed (the LP's
// email on the onboarding session, or the signed-in member), and what was signed
// (the agreement rebuilt here from the session, kept on the row with its
// SHA-256). The browser contributes only the typed name and the tick.
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml, sendEmail } from "@/lib/email";
import { formatSignedAt } from "@/lib/nda";
import { recordAudit } from "@/lib/lp-audit.server";
import { subscriptionAgreementText } from "@/lib/lp-subscription";
import { parseSignaturePng } from "@/lib/signing/signature-image";
import { buildSignedPdf } from "@/lib/signing/executed-pdf.server";
import { sealPdf } from "@/lib/signing/seal.server";
import { SITE_URL } from "@/lib/site";

type Client = SupabaseClient;
export type Party = "lp" | "gp";
export type SignResult = { ok: true; signatureId: string } | { ok: false; error: string };
const GENERIC = "We couldn't record your signature. Please try again.";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

interface SessionFacts {
  id: string;
  organization_id: string;
  lp_name: string;
  lp_email: string;
  fund_id: string | null;
  investor_id: string | null;
  commitment_amount: number | null;
  orgName: string;
  fundName: string;
  jurisdiction: string;
}

/** The session plus the names the agreement is filled with. */
export async function loadSessionFacts(client: Client, sessionId: string, orgId?: string): Promise<SessionFacts | null> {
  let q = client
    .from("lp_onboarding_sessions")
    .select("id, organization_id, lp_name, lp_email, fund_id, investor_id, commitment_amount")
    .eq("id", sessionId);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q.maybeSingle();
  const s = data as Omit<SessionFacts, "orgName" | "fundName" | "jurisdiction"> | null;
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

export function agreementFor(f: SessionFacts, now: Date = new Date()): string {
  return subscriptionAgreementText(
    { fundName: f.fundName, orgName: f.orgName, jurisdiction: f.jurisdiction, investorName: f.lp_name, commitmentAmount: f.commitment_amount },
    now,
  );
}

function checkSigner(
  raw: string,
  agreed: boolean,
  signaturePng: unknown,
): { ok: true; name: string; png: string } | { ok: false; error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Type your full name to sign." };
  if (name.length > 120) return { ok: false, error: "That name is too long." };
  if (!parseSignaturePng(signaturePng)) return { ok: false, error: "Draw or type your signature to sign." };
  if (!agreed) return { ok: false, error: "Tick the box to confirm you agree." };
  return { ok: true, name, png: signaturePng as string };
}

async function insertSignature(
  client: Client,
  row: {
    orgId: string;
    sessionId: string;
    party: Party;
    name: string;
    email: string;
    ipHint: string | null;
    text: string;
    signaturePng: string;
    now: Date;
  },
): Promise<SignResult> {
  const { data, error } = await client
    .from("lp_subscription_signatures")
    .insert({
      organization_id: row.orgId,
      session_id: row.sessionId,
      party: row.party,
      signer_name: row.name,
      signer_email: row.email.trim().toLowerCase(),
      signed_at: row.now.toISOString(),
      ip_hint: row.ipHint,
      agreement_text: row.text,
      agreement_sha256: sha256(row.text),
      signature_png: row.signaturePng,
      agreed: true,
    })
    .select("id")
    .maybeSingle();
  const id = (data as { id: string } | null)?.id;
  if (id) return { ok: true, signatureId: id };
  // Signed already (unique per session and party): the same signature, not an error.
  if (error?.code === "23505") {
    const { data: ex } = await client
      .from("lp_subscription_signatures")
      .select("id")
      .eq("session_id", row.sessionId)
      .eq("party", row.party)
      .maybeSingle();
    const eid = (ex as { id: string } | null)?.id;
    if (eid) return { ok: true, signatureId: eid };
  }
  return { ok: false, error: GENERIC };
}

/** The LP signs. Their email is the one the fund manager invited, never one from the form. */
export async function signAsLp(
  client: Client,
  input: { facts: SessionFacts; signerName: string; signaturePng: string; agreed: boolean; ipHint: string | null; now?: Date },
): Promise<SignResult> {
  const v = checkSigner(input.signerName, input.agreed, input.signaturePng);
  if (!v.ok) return v;
  const now = input.now ?? new Date();
  return insertSignature(client, {
    orgId: input.facts.organization_id,
    sessionId: input.facts.id,
    party: "lp",
    name: v.name,
    email: input.facts.lp_email,
    ipHint: input.ipHint,
    text: agreementFor(input.facts, now),
    signaturePng: v.png,
    now,
  });
}

/**
 * The fund countersigns the text the LP signed, not a fresh rendering: if the
 * LP has not signed there is nothing to countersign, and the two sides always
 * share one fingerprint.
 */
export async function countersign(
  client: Client,
  input: { orgId: string; sessionId: string; signerName: string; signaturePng: string; signerEmail: string; agreed: boolean; now?: Date },
): Promise<SignResult> {
  const v = checkSigner(input.signerName, input.agreed, input.signaturePng);
  if (!v.ok) return v;
  const { data } = await client
    .from("lp_subscription_signatures")
    .select("agreement_text")
    .eq("session_id", input.sessionId)
    .eq("organization_id", input.orgId)
    .eq("party", "lp")
    .maybeSingle();
  const lpText = (data as { agreement_text: string } | null)?.agreement_text;
  if (!lpText) return { ok: false, error: "The LP has not signed yet." };
  return insertSignature(client, {
    orgId: input.orgId,
    sessionId: input.sessionId,
    party: "gp",
    name: v.name,
    email: input.signerEmail,
    ipHint: null,
    text: lpText,
    signaturePng: v.png,
    now: input.now ?? new Date(),
  });
}

// ─── The executed record ─────────────────────────────────────────────────────

interface SigRow {
  id: string;
  organization_id: string;
  session_id: string;
  party: Party;
  signer_name: string;
  signer_email: string;
  signed_at: string;
  ip_hint: string | null;
  agreement_text: string;
  agreement_sha256: string;
  signature_png: string | null;
  copy_sent_at: string | null;
}

async function loadSignatures(client: Client, sessionId: string, orgId?: string): Promise<SigRow[]> {
  let q = client
    .from("lp_subscription_signatures")
    .select("id, organization_id, session_id, party, signer_name, signer_email, signed_at, ip_hint, agreement_text, agreement_sha256, signature_png, copy_sent_at")
    .eq("session_id", sessionId);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return (data ?? []) as SigRow[];
}

/**
 * The executed agreement: the text, then a signature page with each party's drawn
 * signature beside their name and time, sealed with the deploy's certificate when
 * one is configured. A countersignature appears only once it exists.
 */
export async function buildExecutedPdf(
  client: Client,
  sessionId: string,
  orgId?: string,
): Promise<{ pdf: Uint8Array; lpName: string; sealed: boolean } | null> {
  const sigs = await loadSignatures(client, sessionId, orgId);
  const lp = sigs.find((s) => s.party === "lp");
  if (!lp) return null;
  const gp = sigs.find((s) => s.party === "gp");
  const stamp = (label: string, s: SigRow) => ({
    label,
    name: s.signer_name,
    email: s.signer_email,
    signedAt: s.signed_at,
    ipHint: s.ip_hint,
    signaturePng: s.signature_png,
  });
  const built = await buildSignedPdf({
    title: `Subscription Agreement - ${lp.signer_name}`,
    text: lp.agreement_text,
    stamps: [stamp("Investor", lp), ...(gp ? [stamp("Fund", gp)] : [])],
    awaiting: gp ? [] : ["Fund"],
    fingerprint: lp.agreement_sha256,
    recordId: lp.id,
  });
  // Only an agreement both sides have signed is sealed as executed.
  if (!gp) return { pdf: built, lpName: lp.signer_name, sealed: false };
  const sealed = await sealPdf(built, { reason: "Executed subscription agreement", name: "FundExecs OS" });
  return { pdf: sealed.pdf, lpName: lp.signer_name, sealed: sealed.sealed };
}

// ─── Copy links for the LP (who has no account) ──────────────────────────────

function secret(): string {
  return createHmac("sha256", "fx-lp-subscription-copy").update(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").digest("hex");
}
export function copyToken(sessionId: string): string {
  return createHmac("sha256", secret()).update(sessionId).digest("base64url");
}
export function copyTokenValid(sessionId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(copyToken(sessionId));
  return a.length === b.length && timingSafeEqual(a, b);
}
export function copyUrl(sessionId: string): string {
  return `${SITE_URL}/api/lp-subscription/${sessionId}?t=${copyToken(sessionId)}`;
}

// ─── What follows a signature (best effort; the signature stands regardless) ──

/**
 * After the LP signs: tell the fund's owners and admins it is waiting for their
 * countersignature. After the fund countersigns: email the executed copy's link
 * to both sides. Plus an audit event and a CRM timeline entry.
 */
export async function afterSigned(client: Client, sessionId: string, party: Party, actorId?: string): Promise<void> {
  const facts = await loadSessionFacts(client, sessionId);
  if (!facts) return;
  const sigs = await loadSignatures(client, sessionId, facts.organization_id);
  const mine = sigs.find((s) => s.party === party);
  if (!mine) return;
  const when = formatSignedAt(mine.signed_at);
  const link = copyUrl(sessionId);

  await recordAudit(
    client,
    party === "gp" && actorId
      ? { orgId: facts.organization_id, sessionId, action: "subscription.countersigned", actorKind: "user", actorId, detail: { sha: mine.agreement_sha256.slice(0, 16) } }
      : { orgId: facts.organization_id, sessionId, action: "subscription.signed", actorKind: "lp", detail: { sha: mine.agreement_sha256.slice(0, 16) } },
  );

  // CRM timeline on the matching contact (exact email only, the CRM's own rule).
  const { crmMatches } = await import("@/lib/data-room-crm.server");
  const matches = await crmMatches(client as never, facts.organization_id, [facts.lp_email]).catch(() => null);
  const m = matches?.get(facts.lp_email.trim().toLowerCase());
  if (m?.contactId) {
    await client
      .from("network_activities")
      .insert({
        organization_id: facts.organization_id,
        contact_id: m.contactId,
        investor_id: m.investorId ?? facts.investor_id,
        activity_type: "document",
        direction: party === "lp" ? "inbound" : "outbound",
        subject: party === "lp" ? `Signed subscription agreement (${facts.fundName})` : `Countersigned subscription agreement (${facts.fundName})`,
        body: `${party === "lp" ? "LP signed" : "Fund countersigned"} on ${when}.`,
        occurred_at: mine.signed_at,
        is_system: true,
        metadata: { source: "lp_subscription_signature", session_id: sessionId, party },
      })
      .then(() => undefined, () => undefined);
  }

  if (party === "lp") {
    const { data: admins } = await client
      .from("organization_members")
      .select("principal_id")
      .eq("organization_id", facts.organization_id)
      .in("role", ["owner", "admin"]);
    for (const a of (admins ?? []) as { principal_id: string }[]) {
      const { data: u } = await client.auth.admin.getUserById(a.principal_id).catch(() => ({ data: null }));
      const to = (u as { user?: { email?: string } } | null)?.user?.email;
      if (!to) continue;
      await sendEmail({
        orgId: facts.organization_id,
        to: { name: "", email: to },
        subject: `${facts.lp_name} signed the ${facts.fundName} subscription agreement`,
        htmlBody: `<p><strong>${escapeHtml(facts.lp_name)}</strong> signed the subscription agreement for ${escapeHtml(facts.fundName)} on ${escapeHtml(when)}.</p><p>It needs your countersignature in Execute &rarr; Closing.</p>`,
      }).catch(() => undefined);
    }
    return;
  }

  // Countersigned: the agreement is executed. Send both sides the copy.
  const lp = sigs.find((s) => s.party === "lp");
  const body = (name: string) =>
    `<p>Hi ${escapeHtml(name)},</p><p>The subscription agreement for <strong>${escapeHtml(facts.fundName)}</strong> is fully executed (countersigned ${escapeHtml(when)}).</p><p><a href="${link}">Download the signed agreement (PDF)</a></p><p style="font-size:12px;color:#666">Fingerprint (SHA-256):<br><code>${escapeHtml(mine.agreement_sha256)}</code></p>`;
  const recipients = [
    lp ? { name: lp.signer_name, email: lp.signer_email } : null,
    { name: mine.signer_name, email: mine.signer_email },
  ].filter(Boolean) as { name: string; email: string }[];
  let sentAll = true;
  for (const r of recipients) {
    const sent = await sendEmail({
      orgId: facts.organization_id,
      to: r,
      subject: `Executed subscription agreement - ${facts.fundName}`,
      htmlBody: body(r.name),
      allowFallback: true,
    }).catch(() => ({ ok: false }));
    if (!sent.ok) sentAll = false;
  }
  if (sentAll) {
    await client
      .from("lp_subscription_signatures")
      .update({ copy_sent_at: new Date().toISOString() })
      .eq("session_id", sessionId)
      .then(() => undefined, () => undefined);
  }
}
