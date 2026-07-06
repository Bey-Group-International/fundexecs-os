// lib/issuance-view.ts
// Pure view-model helpers for the Execute › Issuance surface. No I/O — these
// derive the presentational issuance ledger from the raw signing envelopes that
// the issuance backend persists (the native IssuanceProvider drafts a security
// as an envelope whose document_content is a subscription agreement), and format
// values for display. Kept pure and side-effect-free so they are unit-testable
// independently of Supabase, the API routes, and React.

// Marker that opens every subscription-agreement document the native issuance
// provider writes (lib/providers/native-signing.ts → buildSubscriptionAgreement).
// Used to distinguish issuance envelopes from ordinary signing envelopes.
export const SUBSCRIPTION_AGREEMENT_MARKER = "SUBSCRIPTION AGREEMENT";

// Ledger status is richer than the provider's draft|issued|cancelled triple: a
// sent-but-not-fully-signed envelope is surfaced as "pending" so the operator
// can tell in-flight issuances from untouched drafts.
export type IssuanceLedgerStatus = "draft" | "pending" | "issued" | "cancelled";

export const LEDGER_STATUS_LABEL: Record<IssuanceLedgerStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  issued: "Issued",
  cancelled: "Cancelled",
};

export interface IssuanceLedgerRow {
  /** securityId in provider terms == the envelope id. */
  securityId: string;
  securityName: string;
  status: IssuanceLedgerStatus;
  dealId: string | null;
  offeringAmountUsd: number | null;
  createdAt: string | null;
  issuedAt: string | null;
}

// Raw envelope row as read from the `envelopes` table (only the columns the
// ledger consumes are typed here).
export interface RawIssuanceEnvelope {
  id: string;
  title: string;
  status: string | null;
  document_content: string | null;
  created_at: string | null;
  completed_at: string | null;
}

/** True when an envelope was created by the issuance flow (vs. plain signing). */
export function isIssuanceEnvelope(content: string | null | undefined): boolean {
  return typeof content === "string" && content.trimStart().startsWith(SUBSCRIPTION_AGREEMENT_MARKER);
}

/** Map an `envelopes.status` value to the issuance ledger status. */
export function mapEnvelopeStatus(raw: string | null | undefined): IssuanceLedgerStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "completed":
      return "issued";
    case "voided":
    case "declined":
      return "cancelled";
    case "sent":
    case "partially_signed":
      return "pending";
    default:
      return "draft";
  }
}

/** Map an IssuanceRecord.status (from a provider result) to the ledger status. */
export function mapRecordStatus(
  status: "draft" | "issued" | "cancelled" | null | undefined,
): IssuanceLedgerStatus {
  if (status === "issued") return "issued";
  if (status === "cancelled") return "cancelled";
  return "draft";
}

/** Extract the offering amount embedded in a subscription-agreement document. */
export function parseOfferingAmount(content: string | null | undefined): number | null {
  if (!content) return null;
  const m = content.match(/Offering Amount:\s*\$([\d,]+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Extract the deal id embedded in a subscription-agreement document. */
export function parseDealId(content: string | null | undefined): string | null {
  if (!content) return null;
  const m = content.match(/Deal ID:\s*([^\n]+)/i);
  if (!m) return null;
  const v = m[1].trim();
  return v.length > 0 ? v : null;
}

/** Derive a ledger row from a raw issuance envelope. */
export function deriveLedgerRow(env: RawIssuanceEnvelope): IssuanceLedgerRow {
  const status = mapEnvelopeStatus(env.status);
  return {
    securityId: env.id,
    securityName: env.title,
    status,
    dealId: parseDealId(env.document_content),
    offeringAmountUsd: parseOfferingAmount(env.document_content),
    createdAt: env.created_at,
    issuedAt: status === "issued" ? env.completed_at : null,
  };
}

/** Filter + map a batch of raw envelopes down to the issuance ledger. */
export function deriveLedger(envelopes: RawIssuanceEnvelope[]): IssuanceLedgerRow[] {
  return envelopes.filter((e) => isIssuanceEnvelope(e.document_content)).map(deriveLedgerRow);
}

/** Format a USD amount for display; null/invalid → em dash. */
export function formatUsd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString("en-US")}`;
  }
}
