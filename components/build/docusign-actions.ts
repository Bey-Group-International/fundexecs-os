"use server";

import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID ?? "";
const ACCESS_TOKEN = process.env.DOCUSIGN_ACCESS_TOKEN ?? "";
const BASE_URL = `https://na4.docusign.net/restapi/v2.1/accounts/${ACCOUNT_ID}`;

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
// sendSubscriptionEnvelope
// ---------------------------------------------------------------------------
export async function sendSubscriptionEnvelope(
  formData: FormData
): Promise<{ envelopeId: string } | { error: string }> {
  const missing = missingConfig();
  if (missing) return missing;

  const template_id = String(formData.get("template_id") ?? "").trim();
  const signer_name = String(formData.get("signer_name") ?? "").trim();
  const signer_email = String(formData.get("signer_email") ?? "").trim();
  const signer_role = String(formData.get("signer_role") ?? "signer").trim();
  const subject = String(
    formData.get("subject") ?? "Subscription Agreement — Please Sign"
  ).trim();

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
      const supabase = createServerClient();
      await supabase.from("docusign_envelopes").insert({
        organization_id: ctx.orgId,
        envelope_id: envelopeId,
        template_id: template_id || null,
        signer_name: signer_name || null,
        signer_email: signer_email || null,
        subject: subject || null,
        status: "sent",
      });
    }
  } catch {
    // Non-fatal — envelope was sent; DB write failure doesn't block the user.
  }

  return { envelopeId };
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
      const supabase = createServerClient();
      await supabase
        .from("docusign_envelopes")
        .update({
          status: data.status,
          ...(data.status === "completed"
            ? { completed_at: new Date().toISOString() }
            : {}),
        })
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

  const supabase = createServerClient();
  const { data } = await supabase
    .from("docusign_envelopes")
    .select(
      "id, envelope_id, subject, status, sent_at, signer_name, signer_email"
    )
    .eq("organization_id", ctx.orgId)
    .order("sent_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((row) => ({
    id: row.envelope_id as string,
    subject: (row.subject as string) ?? "(no subject)",
    status: row.status as string,
    created: row.sent_at as string,
    signer_name: row.signer_name as string | null,
    signer_email: row.signer_email as string | null,
  }));
}
