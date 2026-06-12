/**
 * lib/closings/docusign.ts — the Closings room's e-signature slice.
 *
 * The prototype's signature steps were "executed outside FundExecs OS" and
 * recorded as attestations; #377 left the DocuSign hook documented. This
 * module makes it real, honestly:
 *
 *   - The send path is gated behind the approve loop — nothing reaches a
 *     signer until the operator approves the run.
 *   - It only sends when DocuSign is actually configured (env credentials +
 *     a template). Absent that, it returns a typed `not-configured` result so
 *     the UI shows an honest "Connect DocuSign" state — never a fake send.
 *   - Sending an envelope does NOT mark the step done. Signing happens on
 *     DocuSign; the operator still executes/attests the step separately.
 *
 * The pure helpers (subject, recipient + status mapping, validation) are
 * unit-tested; the single network call is isolated behind `docusignConfig()`.
 */

/* ── display vocabulary ──────────────────────────────────────────────────── */

/** DocuSign's envelope lifecycle, narrowed to the states we surface. */
export type EnvelopeStatus = 'sent' | 'delivered' | 'completed' | 'declined' | 'voided' | 'created';

export const ENVELOPE_DISPLAY: Record<
  EnvelopeStatus,
  { tone: 'neutral' | 'gold' | 'success' | 'danger'; label: string }
> = {
  created: { tone: 'neutral', label: 'Draft envelope' },
  sent: { tone: 'gold', label: 'Sent · awaiting signature' },
  delivered: { tone: 'gold', label: 'Viewed · awaiting signature' },
  completed: { tone: 'success', label: 'Signed' },
  declined: { tone: 'danger', label: 'Declined' },
  voided: { tone: 'danger', label: 'Voided' }
};

/** Map a raw DocuSign status string onto our narrowed union. */
export function mapEnvelopeStatus(raw: string | null | undefined): EnvelopeStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'completed':
    case 'signed':
      return 'completed';
    case 'delivered':
      return 'delivered';
    case 'declined':
      return 'declined';
    case 'voided':
      return 'voided';
    case 'created':
      return 'created';
    default:
      return 'sent';
  }
}

/** Whether an envelope status is terminal (no further signatures expected). */
export function isEnvelopeOpen(status: EnvelopeStatus): boolean {
  return status === 'sent' || status === 'delivered' || status === 'created';
}

/* ── pure request shaping ────────────────────────────────────────────────── */

/** A conservative email check — good enough to refuse an obviously bad send. */
export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
}

/** The envelope subject line — the counterparty plus the step being signed. */
export function signatureSubject(counterparty: string | null, stepName: string): string {
  const who = (counterparty ?? '').trim();
  return who ? `${who} — ${stepName}` : stepName;
}

export interface EnvelopeRequest {
  templateId: string;
  status: 'sent';
  emailSubject: string;
  templateRoles: { email: string; name: string; roleName: string }[];
}

/** Build the template-based envelope definition DocuSign expects. */
export function buildEnvelopeRequest(input: {
  templateId: string;
  roleName: string;
  subject: string;
  signerName: string;
  signerEmail: string;
}): EnvelopeRequest {
  return {
    templateId: input.templateId,
    status: 'sent',
    emailSubject: input.subject,
    templateRoles: [
      {
        email: input.signerEmail.trim(),
        name: input.signerName.trim(),
        roleName: input.roleName
      }
    ]
  };
}

/* ── configuration (the only impure surface) ─────────────────────────────── */

export interface DocusignConfig {
  baseUri: string;
  accountId: string;
  accessToken: string;
  templateId: string;
  roleName: string;
}

/**
 * Read DocuSign config from the environment. Returns `null` when anything
 * required is missing — which the action turns into an honest "not connected"
 * result rather than a failed send. A real connection sets:
 *
 *   DOCUSIGN_BASE_URI     e.g. https://na4.docusign.net
 *   DOCUSIGN_ACCOUNT_ID   the eSignature account id
 *   DOCUSIGN_ACCESS_TOKEN a valid OAuth access token (JWT or auth-code grant)
 *   DOCUSIGN_TEMPLATE_ID  the closing-document template to send from
 *   DOCUSIGN_TEMPLATE_ROLE (optional) the signer role name, defaults to "Signer"
 */
export function docusignConfig(): DocusignConfig | null {
  const baseUri = process.env.DOCUSIGN_BASE_URI?.trim();
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID?.trim();
  const accessToken = process.env.DOCUSIGN_ACCESS_TOKEN?.trim();
  const templateId = process.env.DOCUSIGN_TEMPLATE_ID?.trim();
  if (!baseUri || !accountId || !accessToken || !templateId) return null;
  return {
    baseUri: baseUri.replace(/\/+$/, ''),
    accountId,
    accessToken,
    templateId,
    roleName: process.env.DOCUSIGN_TEMPLATE_ROLE?.trim() || 'Signer'
  };
}

export type SendEnvelopeResult =
  | { ok: true; envelopeId: string; status: EnvelopeStatus }
  | { ok: false; configured: boolean; error: string };

/**
 * Send a signature envelope through the DocuSign eSignature REST API. The only
 * network call in this module; everything it needs is shaped by the pure
 * helpers above. Returns `configured: false` when DocuSign isn't connected so
 * the caller can surface the honest connect state.
 */
export async function sendSignatureEnvelope(input: {
  subject: string;
  signerName: string;
  signerEmail: string;
}): Promise<SendEnvelopeResult> {
  const cfg = docusignConfig();
  if (!cfg) {
    return {
      ok: false,
      configured: false,
      error: 'DocuSign isn’t connected. Connect it in Integrations to send for signature.'
    };
  }

  const body = buildEnvelopeRequest({
    templateId: cfg.templateId,
    roleName: cfg.roleName,
    subject: input.subject,
    signerName: input.signerName,
    signerEmail: input.signerEmail
  });

  try {
    const res = await fetch(`${cfg.baseUri}/restapi/v2.1/accounts/${cfg.accountId}/envelopes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        ok: false,
        configured: true,
        error: `DocuSign rejected the envelope (${res.status}).${detail ? ` ${detail.slice(0, 200)}` : ''}`
      };
    }
    const json = (await res.json()) as { envelopeId?: string; status?: string };
    if (!json.envelopeId) {
      return { ok: false, configured: true, error: 'DocuSign returned no envelope id.' };
    }
    return {
      ok: true,
      envelopeId: json.envelopeId,
      status: mapEnvelopeStatus(json.status)
    };
  } catch {
    return {
      ok: false,
      configured: true,
      error: 'Could not reach DocuSign — check the connection and try again.'
    };
  }
}
