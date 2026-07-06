"use server";

import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID ?? "";
const ACCESS_TOKEN = process.env.DOCUSIGN_ACCESS_TOKEN ?? "";
const DS_HOST = process.env.DOCUSIGN_BASE_URL ?? "https://na4.docusign.net";
const BASE_URL = `${DS_HOST}/restapi/v2.1/accounts/${ACCOUNT_ID}`;

function missingConfig(): { error: string } | null {
  if (!ACCOUNT_ID || !ACCESS_TOKEN) {
    return {
      error:
        "DocuSign not configured. Set DOCUSIGN_ACCESS_TOKEN and DOCUSIGN_ACCOUNT_ID.",
    };
  }
  return null;
}

async function dsGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DocuSign ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function dsPut(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

// Keep the locally-tracked envelope row in sync with an authoritative status.
// Best-effort: never throws — a DB hiccup shouldn't fail the DocuSign action.
async function persistEnvelopeStatus(
  envelopeId: string,
  status: string,
): Promise<void> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return;
    const supabase = await createServerClient();
    await supabase
      .from("docusign_envelopes" as never)
      .update({
        status,
        ...(status.toLowerCase() === "completed"
          ? { completed_at: new Date().toISOString() }
          : {}),
      } as never)
      .eq("envelope_id", envelopeId)
      .eq("organization_id", ctx.orgId);
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// listDocuSignTemplates
// ---------------------------------------------------------------------------
export async function listDocuSignTemplates(): Promise<
  Array<{ id: string; name: string }>
> {
  const missing = missingConfig();
  if (missing) return [];

  try {
    const data = await dsGet<{
      envelopeTemplates?: Array<{ templateId: string; name: string }>;
    }>("/templates");
    return (data.envelopeTemplates ?? []).map((t) => ({
      id: t.templateId,
      name: t.name,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// sendOne — shared envelope-creation + Supabase-persist core
// ---------------------------------------------------------------------------
// Creates a single DocuSign envelope from a template and records it locally.
// The bulk action (sendSubscriptionEnvelopesBulk) delegates here per recipient
// so the send + persist logic lives in exactly one place. Callers are
// responsible for the missingConfig() gate before invoking this.
async function sendOne({
  template_id,
  signer_name,
  signer_email,
  signer_role,
  subject,
}: {
  template_id: string;
  signer_name: string;
  signer_email: string;
  signer_role: string;
  subject: string;
}): Promise<{ envelopeId: string } | { error: string }> {
  if (!template_id || !signer_name || !signer_email) {
    return { error: "template_id, signer_name and signer_email are required." };
  }

  const body = {
    templateId: template_id,
    emailSubject: subject,
    status: "sent",
    templateRoles: [
      {
        roleName: signer_role,
        name: signer_name,
        email: signer_email,
      },
    ],
  };

  let envelopeId: string;
  try {
    const res = await fetch(`${BASE_URL}/envelopes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `DocuSign error ${res.status}: ${text}` };
    }
    const data = (await res.json()) as { envelopeId: string };
    envelopeId = data.envelopeId;
  } catch (err) {
    return { error: String(err) };
  }

  // Persist to Supabase
  try {
    const ctx = await getSessionContext();
    if (ctx?.orgId) {
      const supabase = await createServerClient();
      await supabase.from("docusign_envelopes" as never).insert({
        organization_id: ctx.orgId,
        envelope_id: envelopeId,
        template_id: template_id || null,
        signer_name: signer_name || null,
        signer_email: signer_email || null,
        subject: subject || null,
        status: "sent",
      } as never);
    }
  } catch {
    // Non-fatal — envelope was sent; DB write failure doesn't block the user.
  }

  return { envelopeId };
}

// ---------------------------------------------------------------------------
// sendSubscriptionEnvelopesBulk — send one envelope per recipient in one call
// ---------------------------------------------------------------------------
// Shares a single template, role and subject across every recipient. Recipients
// are passed as a JSON string field `recipients` = [{ name, email }]. Each is
// sent sequentially via the shared sendOne() core; the result partitions the
// outcomes into sent (with envelope ids) and failed (with reasons) so the
// client can prepend successes and surface a concise summary.
export async function sendSubscriptionEnvelopesBulk(
  formData: FormData
): Promise<{
  sent: Array<{ name: string; email: string; envelopeId: string }>;
  failed: Array<{ name: string; email: string; error: string }>;
}> {
  const missing = missingConfig();
  if (missing) {
    return { sent: [], failed: [{ name: "", email: "", error: missing.error }] };
  }

  const template_id = String(formData.get("template_id") ?? "").trim();
  const signer_role = String(formData.get("signer_role") ?? "signer").trim();
  const subject = String(
    formData.get("subject") ?? "Subscription Agreement — Please Sign"
  ).trim();

  let recipients: Array<{ name: string; email: string }> = [];
  try {
    const raw = JSON.parse(String(formData.get("recipients") ?? "[]"));
    if (Array.isArray(raw)) {
      recipients = raw.map((r) => ({
        name: String(r?.name ?? "").trim(),
        email: String(r?.email ?? "").trim(),
      }));
    }
  } catch {
    return {
      sent: [],
      failed: [{ name: "", email: "", error: "Invalid recipients payload." }],
    };
  }

  if (recipients.length === 0) {
    return {
      sent: [],
      failed: [{ name: "", email: "", error: "No recipients provided." }],
    };
  }

  const sent: Array<{ name: string; email: string; envelopeId: string }> = [];
  const failed: Array<{ name: string; email: string; error: string }> = [];

  // Sequential so a slow/failed recipient never masks the others and DocuSign
  // isn't hit with a burst of concurrent envelope creates.
  for (const r of recipients) {
    const result = await sendOne({
      template_id,
      signer_name: r.name,
      signer_email: r.email,
      signer_role,
      subject,
    });
    if ("error" in result) {
      failed.push({ name: r.name, email: r.email, error: result.error });
    } else {
      sent.push({ name: r.name, email: r.email, envelopeId: result.envelopeId });
    }
  }

  return { sent, failed };
}

// Terminal DocuSign envelope states — no further status changes are possible,
// so they are excluded from polling and refresh sweeps.
const TERMINAL_STATUSES = new Set(["completed", "declined", "voided"]);

// ---------------------------------------------------------------------------
// refreshPendingEnvelopes — sync every non-terminal envelope in one sweep
// ---------------------------------------------------------------------------
// Fetches the current DocuSign status for every locally-tracked envelope that
// hasn't reached a terminal state, persists any changes, and returns the fresh
// statuses so the client can reconcile in a single round-trip. Best-effort per
// envelope: a failed lookup keeps the last known status rather than erroring.
export async function refreshPendingEnvelopes(): Promise<
  Array<{ id: string; status: string }>
> {
  const missing = missingConfig();
  if (missing) return [];
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];
  const orgId = ctx.orgId;

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("docusign_envelopes" as never)
    .select("envelope_id, status")
    .eq("organization_id", orgId)
    .limit(50);

  type Row = { envelope_id: string; status: string };
  const pending = ((data ?? []) as Row[]).filter(
    (r) => !TERMINAL_STATUSES.has((r.status ?? "").toLowerCase()),
  );
  if (pending.length === 0) return [];

  const prevById = new Map(pending.map((r) => [r.envelope_id, r.status]));

  // One bulk call for every pending envelope instead of N per-envelope GETs.
  // `envelope_ids=request_body` tells DocuSign to read the id list from the body.
  let statuses: Array<{ envelopeId: string; status: string }> = [];
  try {
    const res = await dsPut(
      "/envelopes/status?envelope_ids=request_body",
      { envelopeIds: [...prevById.keys()] },
    );
    if (res.ok) {
      const body = (await res.json()) as {
        envelopes?: Array<{ envelopeId: string; status: string }>;
      };
      statuses = body.envelopes ?? [];
    }
  } catch {
    // Best-effort — a failed sweep leaves statuses untouched.
  }

  const results = [...prevById.entries()].map(([id, prev]) => {
    const fresh = statuses.find((s) => s.envelopeId === id);
    return { id, status: fresh?.status ?? prev, prev };
  });

  // Persist only the envelopes whose status actually changed.
  await Promise.all(
    results
      .filter((res) => res.status !== res.prev)
      .map((res) =>
        supabase
          .from("docusign_envelopes" as never)
          .update({
            status: res.status,
            ...(res.status.toLowerCase() === "completed"
              ? { completed_at: new Date().toISOString() }
              : {}),
          } as never)
          .eq("envelope_id", res.id)
          .eq("organization_id", orgId),
      ),
  );

  return results.map((r) => ({ id: r.id, status: r.status }));
}

// ---------------------------------------------------------------------------
// voidEnvelope — cancel an in-flight envelope so it can no longer be signed
// ---------------------------------------------------------------------------
export async function voidEnvelope(
  envelopeId: string,
  reason?: string,
): Promise<{ ok: true } | { error: string }> {
  const missing = missingConfig();
  if (missing) return missing;
  if (!envelopeId) return { error: "Missing envelope id" };

  try {
    const res = await dsPut(`/envelopes/${envelopeId}`, {
      status: "voided",
      voidedReason: (reason && reason.trim()) || "Voided from FundExecs",
    });
    if (!res.ok) {
      return { error: `DocuSign error ${res.status}: ${await res.text()}` };
    }
  } catch (err) {
    return { error: String(err) };
  }

  await persistEnvelopeStatus(envelopeId, "voided");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// resendEnvelope — re-deliver the signing request to current recipients
// (DocuSign's resend is the on-demand reminder mechanism in the REST API)
// ---------------------------------------------------------------------------
export async function resendEnvelope(
  envelopeId: string,
): Promise<{ ok: true } | { error: string }> {
  const missing = missingConfig();
  if (missing) return missing;
  if (!envelopeId) return { error: "Missing envelope id" };

  try {
    const recipients = await dsGet<Record<string, unknown>>(
      `/envelopes/${envelopeId}/recipients`,
    );
    const res = await dsPut(
      `/envelopes/${envelopeId}/recipients?resend_envelope=true`,
      recipients,
    );
    if (!res.ok) {
      return { error: `DocuSign error ${res.status}: ${await res.text()}` };
    }
  } catch (err) {
    return { error: String(err) };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// listSignerContacts — investors with an email, for send-modal autofill
// ---------------------------------------------------------------------------
export async function listSignerContacts(): Promise<
  Array<{ name: string; email: string }>
> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("investors")
    .select("name, contact_name, contact_email")
    .eq("organization_id", ctx.orgId)
    .limit(200);

  type Row = {
    name: string;
    contact_name: string | null;
    contact_email: string | null;
  };
  const out: Array<{ name: string; email: string }> = [];
  const seen = new Set<string>();
  for (const r of (data ?? []) as Row[]) {
    const email = (r.contact_email ?? "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: (r.contact_name ?? r.name ?? "").trim(), email });
  }
  return out;
}

// ---------------------------------------------------------------------------
// getEnvelopeStatus
// ---------------------------------------------------------------------------
export async function getEnvelopeStatus(
  envelopeId: string
): Promise<{ status: string }> {
  const missing = missingConfig();
  if (missing) return { status: "unknown" };

  try {
    const data = await dsGet<{ status: string }>(
      `/envelopes/${envelopeId}`
    );
    // Keep local DB in sync
    const ctx = await getSessionContext();
    if (ctx?.orgId) {
      const supabase = await createServerClient();
      await supabase
        .from("docusign_envelopes" as never)
        .update({
          status: data.status,
          ...(data.status === "completed"
            ? { completed_at: new Date().toISOString() }
            : {}),
        } as never)
        .eq("envelope_id", envelopeId)
        .eq("organization_id", ctx.orgId);
    }
    return { status: data.status };
  } catch {
    return { status: "unknown" };
  }
}

// ---------------------------------------------------------------------------
// listSentEnvelopes
// ---------------------------------------------------------------------------
export async function listSentEnvelopes(): Promise<
  Array<{
    id: string;
    subject: string;
    status: string;
    created: string;
    signer_name: string | null;
    signer_email: string | null;
  }>
> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("docusign_envelopes" as never)
    .select(
      "id, envelope_id, subject, status, sent_at, signer_name, signer_email"
    )
    .eq("organization_id", ctx.orgId)
    .order("sent_at", { ascending: false })
    .limit(50);

  type EnvRow = { envelope_id: string; subject: string | null; status: string; sent_at: string; signer_name: string | null; signer_email: string | null };
  return ((data ?? []) as EnvRow[]).map((row) => ({
    id: row.envelope_id,
    subject: row.subject ?? "(no subject)",
    status: row.status,
    created: row.sent_at,
    signer_name: row.signer_name,
    signer_email: row.signer_email,
  }));
}
