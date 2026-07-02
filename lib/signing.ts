/**
 * signing.ts — Native document signing system (DocuSign replacement).
 *
 * NOTE on signing_token lookups:
 * The getSigningData function is used by the public /sign/[token] page.
 * That page must use the PUBLIC Supabase client (anon key, no auth session)
 * so that unauthenticated signers can access their envelope. The RLS policies
 * on signing_envelopes, signing_recipients, and signing_fields must permit
 * SELECT via signing_token without requiring authentication.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnvelopeStatus =
  | "draft"
  | "sent"
  | "partially_signed"
  | "completed"
  | "voided";

export type RecipientStatus = "pending" | "viewed" | "signed" | "declined";

export type FieldType =
  | "signature"
  | "initials"
  | "text"
  | "date"
  | "checkbox";

export interface EnvelopeRow {
  id: string;
  organization_id: string;
  title: string;
  message: string | null;
  document_content: string | null;
  document_type: string | null;
  file_url: string | null;
  status: EnvelopeStatus;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RecipientRow {
  id: string;
  envelope_id: string;
  name: string;
  email: string;
  routing_order: number;
  signing_token: string;
  status: RecipientStatus;
  signed_at: string | null;
  signature_data: string | null;
  initials_data: string | null;
}

export interface FieldRow {
  id: string;
  envelope_id: string;
  recipient_id: string;
  field_type: FieldType;
  page: number;
  x_pct: number;
  y_pct: number;
  width_pct: number | null;
  height_pct: number | null;
  label: string | null;
  required: boolean;
  response: string | null;
}

export interface CreateEnvelopeArgs {
  supabase: SupabaseClient<Database>;
  orgId: string;
  createdBy: string;
  title: string;
  message?: string;
  documentContent: string;
  recipients: Array<{
    name: string;
    email: string;
    routingOrder?: number;
  }>;
  fields?: Array<{
    recipientIndex: number;
    fieldType: FieldType;
    page?: number;
    xPct: number;
    yPct: number;
    widthPct?: number;
    heightPct?: number;
    label?: string;
    required?: boolean;
  }>;
}

export interface SigningData {
  envelope: EnvelopeRow;
  recipients: RecipientRow[];
  fields: FieldRow[];
  currentRecipient: RecipientRow | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function logEvent(
  supabase: SupabaseClient<Database>,
  envelopeId: string,
  eventType: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  // Best-effort — do not throw on failure
  try {
    await (supabase as SupabaseClient).from("signing_events").insert({
      envelope_id: envelopeId,
      event_type: eventType,
      metadata: metadata ?? null,
    });
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// createEnvelope
// ---------------------------------------------------------------------------

export async function createEnvelope(args: CreateEnvelopeArgs): Promise<{
  ok: boolean;
  envelopeId?: string;
  detail: string;
  error?: string;
}> {
  const {
    supabase,
    orgId,
    createdBy,
    title,
    message,
    documentContent,
    recipients,
    fields,
  } = args;

  // 1. Insert envelope
  const { data: envelope, error: envError } = await supabase
    .from("signing_envelopes")
    .insert({
      organization_id: orgId,
      created_by: createdBy,
      title,
      message: message ?? null,
      document_content: documentContent,
      status: "draft" as EnvelopeStatus,
    })
    .select()
    .single();

  if (envError || !envelope) {
    return {
      ok: false,
      detail: "Failed to create envelope",
      error: envError?.message ?? "Unknown error",
    };
  }

  const envelopeId: string = envelope.id;

  // 2. Insert recipients
  const recipientInserts = recipients.map((r, idx) => ({
    envelope_id: envelopeId,
    name: r.name,
    email: r.email,
    routing_order: r.routingOrder ?? idx + 1,
    status: "pending" as RecipientStatus,
  }));

  const { data: insertedRecipients, error: recipError } = await supabase
    .from("signing_recipients")
    .insert(recipientInserts)
    .select();

  if (recipError || !insertedRecipients) {
    return {
      ok: false,
      envelopeId,
      detail: "Failed to insert recipients",
      error: recipError?.message ?? "Unknown error",
    };
  }

  // 3. Insert fields (if any)
  if (fields && fields.length > 0) {
    const fieldInserts = fields.map((f) => {
      const recipient = insertedRecipients[f.recipientIndex];
      if (!recipient) {
        throw new Error(
          `No recipient at index ${f.recipientIndex} for field`
        );
      }
      return {
        envelope_id: envelopeId,
        recipient_id: recipient.id,
        field_type: f.fieldType,
        page: f.page ?? 1,
        x_pct: f.xPct,
        y_pct: f.yPct,
        width_pct: f.widthPct ?? null,
        height_pct: f.heightPct ?? null,
        label: f.label ?? null,
        required: f.required ?? true,
      };
    });

    const { error: fieldError } = await supabase
      .from("signing_fields")
      .insert(fieldInserts);

    if (fieldError) {
      return {
        ok: false,
        envelopeId,
        detail: "Failed to insert fields",
        error: fieldError.message,
      };
    }
  }

  // 4. Log event
  await logEvent(supabase, envelopeId, "created", {
    recipient_count: recipients.length,
  });

  return { ok: true, envelopeId, detail: "Envelope created" };
}

// ---------------------------------------------------------------------------
// sendEnvelope
// ---------------------------------------------------------------------------

export async function sendEnvelope(
  supabase: SupabaseClient<Database>,
  envelopeId: string,
  baseUrl: string
): Promise<{
  ok: boolean;
  detail: string;
  signingUrls?: Array<{ recipientId: string; name: string; email: string; url: string }>;
  error?: string;
}> {
  // Update envelope status
  const { error: updateError } = await supabase
    .from("signing_envelopes")
    .update({ status: "sent" as EnvelopeStatus })
    .eq("id", envelopeId);

  if (updateError) {
    return {
      ok: false,
      detail: "Failed to update envelope status",
      error: updateError.message,
    };
  }

  // Fetch recipients to build signing URLs
  const { data: recipients, error: recipError } = await supabase
    .from("signing_recipients")
    .select()
    .eq("envelope_id", envelopeId)
    .order("routing_order", { ascending: true });

  if (recipError || !recipients) {
    return {
      ok: false,
      detail: "Failed to fetch recipients",
      error: recipError?.message ?? "Unknown error",
    };
  }

  const signingUrls = recipients.map((r) => ({
    recipientId: r.id as string,
    name: r.name as string,
    email: r.email as string,
    url: `${baseUrl}/sign/${r.signing_token}`,
  }));

  await logEvent(supabase, envelopeId, "sent", {
    recipient_count: recipients.length,
  });

  // Email sending is handled separately by the API route
  return {
    ok: true,
    detail: "Envelope sent",
    signingUrls,
  };
}

// ---------------------------------------------------------------------------
// getSigningData
// ---------------------------------------------------------------------------

/**
 * IMPORTANT: Pass the PUBLIC (anon) Supabase client here when called from
 * the /sign/[token] page. The signing_token lookup must work without an
 * authenticated session so unauthenticated signers can view their envelope.
 */
export async function getSigningData(
  signingToken: string,
  supabase: SupabaseClient<Database>
): Promise<SigningData | null> {
  // Find recipient by token
  const { data: recipient, error: recipError } = await supabase
    .from("signing_recipients")
    .select()
    .eq("signing_token", signingToken)
    .single();

  if (recipError || !recipient) {
    return null;
  }

  const envelopeId: string = recipient.envelope_id as string;

  // Fetch envelope
  const { data: envelope, error: envError } = await supabase
    .from("signing_envelopes")
    .select()
    .eq("id", envelopeId)
    .single();

  if (envError || !envelope) {
    return null;
  }

  // Fetch all recipients for envelope
  const { data: allRecipients, error: allRecipError } = await supabase
    .from("signing_recipients")
    .select()
    .eq("envelope_id", envelopeId)
    .order("routing_order", { ascending: true });

  if (allRecipError || !allRecipients) {
    return null;
  }

  // Fetch fields
  const { data: fields, error: fieldsError } = await supabase
    .from("signing_fields")
    .select()
    .eq("envelope_id", envelopeId);

  if (fieldsError) {
    return null;
  }

  // Side effect: mark recipient as 'viewed' if currently 'pending'
  if (recipient.status === "pending") {
    await supabase
      .from("signing_recipients")
      .update({ status: "viewed" as RecipientStatus })
      .eq("id", recipient.id);

    // Update local reference for returned data
    (recipient as Record<string, unknown>).status = "viewed";
  }

  return {
    envelope: envelope as unknown as EnvelopeRow,
    recipients: allRecipients as unknown as RecipientRow[],
    fields: (fields ?? []) as unknown as FieldRow[],
    currentRecipient: recipient as unknown as RecipientRow,
  };
}

// ---------------------------------------------------------------------------
// completeSignature
// ---------------------------------------------------------------------------

export async function completeSignature(args: {
  supabase: SupabaseClient<Database>;
  signingToken: string;
  signatureData: string;
  initialsData?: string;
  fieldResponses: Record<string, string>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{
  ok: boolean;
  detail: string;
  envelopeCompleted: boolean;
  error?: string;
}> {
  const {
    supabase,
    signingToken,
    signatureData,
    initialsData,
    fieldResponses,
    ipAddress,
    userAgent,
  } = args;

  // Find recipient by token
  const { data: recipient, error: recipError } = await supabase
    .from("signing_recipients")
    .select()
    .eq("signing_token", signingToken)
    .single();

  if (recipError || !recipient) {
    return {
      ok: false,
      detail: "Recipient not found",
      envelopeCompleted: false,
      error: recipError?.message ?? "Not found",
    };
  }

  const envelopeId: string = recipient.envelope_id as string;
  const recipientId: string = recipient.id as string;

  // Mark recipient as signed
  const { error: signError } = await supabase
    .from("signing_recipients")
    .update({
      status: "signed" as RecipientStatus,
      signed_at: new Date().toISOString(),
      signature_data: signatureData,
      initials_data: initialsData ?? null,
    })
    .eq("id", recipientId);

  if (signError) {
    return {
      ok: false,
      detail: "Failed to save signature",
      envelopeCompleted: false,
      error: signError.message,
    };
  }

  // Save field responses
  const fieldIds = Object.keys(fieldResponses);
  if (fieldIds.length > 0) {
    for (const fieldId of fieldIds) {
      await supabase
        .from("signing_fields")
        .update({ response: fieldResponses[fieldId] })
        .eq("id", fieldId)
        .eq("recipient_id", recipientId);
    }
  }

  await logEvent(supabase, envelopeId, "signed", {
    recipient_id: recipientId,
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  // Check if all recipients have signed
  const { data: allRecipients, error: allError } = await supabase
    .from("signing_recipients")
    .select("status")
    .eq("envelope_id", envelopeId);

  if (allError || !allRecipients) {
    return {
      ok: true,
      detail: "Signature saved",
      envelopeCompleted: false,
    };
  }

  const allSigned = allRecipients.every((r) => r.status === "signed");

  if (allSigned) {
    await supabase
      .from("signing_envelopes")
      .update({
        status: "completed" as EnvelopeStatus,
        completed_at: new Date().toISOString(),
      })
      .eq("id", envelopeId);

    await logEvent(supabase, envelopeId, "completed", {
      completed_by: recipientId,
    });

    return { ok: true, detail: "Envelope completed", envelopeCompleted: true };
  }

  // Check if partially signed (some but not all)
  const someSigned = allRecipients.some((r) => r.status === "signed");
  if (someSigned) {
    await supabase
      .from("signing_envelopes")
      .update({ status: "partially_signed" as EnvelopeStatus })
      .eq("id", envelopeId);
  }

  return { ok: true, detail: "Signature saved", envelopeCompleted: false };
}

// ---------------------------------------------------------------------------
// getEnvelopesByOrg
// ---------------------------------------------------------------------------

export async function getEnvelopesByOrg(
  supabase: SupabaseClient<Database>,
  orgId: string
): Promise<EnvelopeRow[]> {
  const { data, error } = await supabase
    .from("signing_envelopes")
    .select()
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as unknown as EnvelopeRow[];
}

// ---------------------------------------------------------------------------
// getEnvelopeById
// ---------------------------------------------------------------------------

export async function getEnvelopeById(
  supabase: SupabaseClient<Database>,
  envelopeId: string
): Promise<{
  envelope: EnvelopeRow;
  recipients: RecipientRow[];
  fields: FieldRow[];
} | null> {
  const [envRes, recipRes, fieldsRes] = await Promise.all([
    supabase
      .from("signing_envelopes")
      .select()
      .eq("id", envelopeId)
      .single(),
    supabase
      .from("signing_recipients")
      .select()
      .eq("envelope_id", envelopeId)
      .order("routing_order", { ascending: true }),
    supabase
      .from("signing_fields")
      .select()
      .eq("envelope_id", envelopeId),
  ]);

  if (envRes.error || !envRes.data) {
    return null;
  }

  return {
    envelope: envRes.data as unknown as EnvelopeRow,
    recipients: (recipRes.data ?? []) as unknown as RecipientRow[],
    fields: (fieldsRes.data ?? []) as unknown as FieldRow[],
  };
}

// ---------------------------------------------------------------------------
// voidEnvelope
// ---------------------------------------------------------------------------

export async function voidEnvelope(
  supabase: SupabaseClient<Database>,
  envelopeId: string,
  reason?: string
): Promise<{ ok: boolean; detail: string }> {
  const { error } = await supabase
    .from("signing_envelopes")
    .update({ status: "voided" as EnvelopeStatus })
    .eq("id", envelopeId);

  if (error) {
    return { ok: false, detail: error.message };
  }

  await logEvent(supabase, envelopeId, "voided", { reason: reason ?? null });

  return { ok: true, detail: "Envelope voided" };
}
