// lib/envelope-notify.server.ts
//
// The emails that move an envelope along: the owner is told when a recipient has
// signed and it is their turn; both sides are given the executed copy once the owner
// has countersigned. Best effort: a failed email never undoes a signature.
import "server-only";
import { escapeHtml, sendEmail } from "@/lib/email";
import { createServiceClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import { createHmac, timingSafeEqual } from "crypto";

function secret() {
  return createHmac("sha256", "fx-envelope-copy").update(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").digest("hex");
}
export function envelopeCopyToken(envelopeId: string): string {
  return createHmac("sha256", secret()).update(envelopeId).digest("base64url");
}
export function envelopeCopyTokenValid(envelopeId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(envelopeCopyToken(envelopeId));
  return a.length === b.length && timingSafeEqual(a, b);
}
export const envelopeCopyUrl = (id: string) => `${SITE_URL}/api/envelopes/${id}/executed?t=${envelopeCopyToken(id)}`;

interface Row {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

async function load(envelopeId: string) {
  const db = createServiceClient();
  const [{ data: env }, { data: recs }] = await Promise.all([
    db.from("envelopes").select("id, title, organization_id").eq("id", envelopeId).maybeSingle(),
    db.from("envelope_recipients").select("id, name, email, role, status").eq("envelope_id", envelopeId),
  ]);
  return { env: env as { id: string; title: string; organization_id: string } | null, recs: (recs ?? []) as Row[] };
}

/** A recipient signed and the owner has yet to: tell the owner it is their turn. */
export async function notifyOwnerToCountersign(envelopeId: string): Promise<void> {
  const { env, recs } = await load(envelopeId);
  const owner = recs.find((r) => r.role === "owner");
  if (!env || !owner || owner.status === "signed") return;
  const signed = recs.filter((r) => r.role !== "owner" && r.status === "signed").map((r) => r.name);
  await sendEmail({
    orgId: env.organization_id,
    to: { name: owner.name, email: owner.email },
    subject: `Ready for your countersignature: ${env.title}`,
    htmlBody: `<p><strong>${escapeHtml(signed.join(", ") || "A recipient")}</strong> signed <strong>${escapeHtml(env.title)}</strong>.</p><p>Step 3 of 3 is yours: <a href="${SITE_URL}/envelopes/${env.id}">review their answers and countersign</a>.</p>`,
    allowFallback: true,
  }).catch(() => undefined);
}

/** Everyone has signed: send each person the executed copy. */
export async function notifyCompleted(envelopeId: string): Promise<void> {
  const { env, recs } = await load(envelopeId);
  if (!env) return;
  const link = envelopeCopyUrl(envelopeId);
  for (const r of recs) {
    await sendEmail({
      orgId: env.organization_id,
      to: { name: r.name, email: r.email },
      subject: `Fully signed: ${env.title}`,
      htmlBody: `<p>Hi ${escapeHtml(r.name)},</p><p><strong>${escapeHtml(env.title)}</strong> has been signed by everyone.</p><p><a href="${link}">Download the signed document (PDF)</a></p>`,
      allowFallback: true,
    }).catch(() => undefined);
  }
}
