// lib/providers/stripe-rail.ts
// CapitalRailProvider backed by Stripe Treasury + Stripe Transfers.
//
// Rail mapping:
//   "internal" → Stripe Transfer (between connected accounts)
//   "ach"      → Stripe Treasury OutboundTransfer (ACH credit push)
//   "wire"     → Stripe Treasury OutboundPayment (wire)
//   "card"     → not supported for fund capital movements
//
// Requires STRIPE_SECRET_KEY. ACH/wire additionally require
// STRIPE_FINANCIAL_ACCOUNT_ID (the Treasury financial account to move from).
// Falls back to the mock provider when unconfigured.
import type {
  CapitalRailProvider,
  CapitalRailType,
  CapitalTransferParams,
  CapitalTransferRecord,
  ProviderResult,
} from "./types";

function configured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function treasuryConfigured(): boolean {
  return configured() && Boolean(process.env.STRIPE_FINANCIAL_ACCOUNT_ID);
}

const STRIPE_API = "https://api.stripe.com/v1";

// Stripe IDs are alphanumeric+underscore only — validate before interpolating into paths.
function assertStripeId(id: string): void {
  if (!/^[a-zA-Z0-9_]+$/.test(id)) throw new Error(`Invalid Stripe ID: "${id}"`);
}

// Float-safe USD→cents conversion: normalize to 10 decimal places before multiplying.
function usdToCents(amountUsd: number): number {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error(`Invalid transfer amount: ${amountUsd}`);
  }
  return Math.round(Number(amountUsd.toFixed(10)) * 100);
}

async function stripePost<T>(path: string, body: URLSearchParams, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Stripe ${path}: ${res.status} — ${text}`);
  }
  return res.json() as Promise<T>;
}

async function stripeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Stripe ${path}: ${res.status} — ${text}`);
  }
  return res.json() as Promise<T>;
}

function mapTransferStatus(s: string): CapitalTransferRecord["status"] {
  if (s === "posted" || s === "paid" || s === "succeeded") return "settled";
  if (s === "failed" || s === "canceled" || s === "reversed" || s === "returned") return "failed";
  if (s === "processing" || s === "pending" || s === "in_transit") return "pending";
  return "initiated";
}

export const stripeCapitalRailProvider: CapitalRailProvider = {
  name: "stripe-treasury",
  isConfigured: configured,
  supportedRails(): CapitalRailType[] {
    const rails: CapitalRailType[] = ["internal"];
    if (treasuryConfigured()) rails.push("ach", "wire");
    return rails;
  },

  async initiate(params: CapitalTransferParams): Promise<ProviderResult<CapitalTransferRecord>> {
    if (!configured()) {
      return {
        ok: false,
        live: false,
        detail: "Stripe not configured — set STRIPE_SECRET_KEY to enable capital transfers.",
        data: { transferId: "", status: "failed" },
      };
    }

    const amountCents = usdToCents(params.amountUsd);
    const description = params.memo ?? `${params.railType.toUpperCase()} transfer — capital event ${params.capitalEventId}`;

    try {
      if (params.railType === "internal") {
        // Stripe Transfer between connected accounts.
        const body = new URLSearchParams({
          amount: String(amountCents),
          currency: "usd",
          destination: params.toAccountRef,
          description,
          "metadata[org_id]": params.orgId,
          "metadata[capital_event_id]": params.capitalEventId,
          "metadata[requested_by]": params.requestedBy,
        });
        const transfer = await stripePost<{ id: string; amount: number }>(
          "/transfers",
          body,
          `stripe-transfer|${params.orgId}|${params.capitalEventId}`,
        );
        return {
          ok: true,
          live: true,
          detail: `Internal transfer of $${params.amountUsd.toLocaleString()} initiated via Stripe Connect.`,
          reference: transfer.id,
          data: { transferId: transfer.id, status: "initiated" },
        };
      }

      if ((params.railType === "ach" || params.railType === "wire") && !treasuryConfigured()) {
        return {
          ok: false,
          live: false,
          detail: `${params.railType.toUpperCase()} transfers require a Stripe Treasury financial account — set STRIPE_FINANCIAL_ACCOUNT_ID.`,
          data: { transferId: "", status: "failed" },
        };
      }

      if (params.railType === "ach") {
        // Stripe Treasury OutboundTransfer (ACH credit push from financial account).
        const body = new URLSearchParams({
          amount: String(amountCents),
          currency: "usd",
          financial_account: process.env.STRIPE_FINANCIAL_ACCOUNT_ID!,
          destination_payment_method: params.toAccountRef,
          network: "ach",
          description,
          "metadata[org_id]": params.orgId,
          "metadata[capital_event_id]": params.capitalEventId,
          "metadata[requested_by]": params.requestedBy,
        });
        const ot = await stripePost<{ id: string; status: string }>(
          "/treasury/outbound_transfers",
          body,
          `stripe-ach|${params.orgId}|${params.capitalEventId}`,
        );
        return {
          ok: true,
          live: true,
          detail: `ACH transfer of $${params.amountUsd.toLocaleString()} initiated via Stripe Treasury.`,
          reference: ot.id,
          data: { transferId: ot.id, status: mapTransferStatus(ot.status) },
        };
      }

      if (params.railType === "wire") {
        // Stripe Treasury OutboundPayment (wire).
        const body = new URLSearchParams({
          amount: String(amountCents),
          currency: "usd",
          financial_account: process.env.STRIPE_FINANCIAL_ACCOUNT_ID!,
          destination_payment_method: params.toAccountRef,
          network: "us_domestic_wire",
          statement_descriptor: description.slice(0, 22),
          "metadata[org_id]": params.orgId,
          "metadata[capital_event_id]": params.capitalEventId,
          "metadata[requested_by]": params.requestedBy,
        });
        const op = await stripePost<{ id: string; status: string }>(
          "/treasury/outbound_payments",
          body,
          `stripe-wire|${params.orgId}|${params.capitalEventId}`,
        );
        return {
          ok: true,
          live: true,
          detail: `Wire transfer of $${params.amountUsd.toLocaleString()} initiated via Stripe Treasury.`,
          reference: op.id,
          data: { transferId: op.id, status: mapTransferStatus(op.status) },
        };
      }

      return {
        ok: false,
        live: false,
        detail: `Rail type "${params.railType}" is not supported.`,
        data: { transferId: "", status: "failed" },
      };
    } catch (err) {
      return {
        ok: false,
        live: false,
        detail: `Capital transfer of $${params.amountUsd.toLocaleString()} could not be initiated.`,
        error: err instanceof Error ? err.message : String(err),
        data: { transferId: "", status: "failed" },
      };
    }
  },

  async getStatus(transferId: string): Promise<ProviderResult<CapitalTransferRecord>> {
    if (!configured()) {
      return {
        ok: false,
        live: false,
        detail: "Stripe not configured.",
        data: { transferId, status: "pending" },
      };
    }

    assertStripeId(transferId);
    const safeId = encodeURIComponent(transferId);
    // Try Treasury OutboundTransfer first, then OutboundPayment, then Transfer.
    const paths = [
      `/treasury/outbound_transfers/${safeId}`,
      `/treasury/outbound_payments/${safeId}`,
      `/transfers/${safeId}`,
    ];

    for (const path of paths) {
      try {
        const obj = await stripeGet<{ id: string; status: string; amount: number; created: number }>(path);
        const status = mapTransferStatus(obj.status);
        return {
          ok: true,
          live: true,
          detail: `Transfer ${transferId}: ${obj.status}.`,
          data: {
            transferId: obj.id,
            status,
            // Use Stripe's authoritative created timestamp, not the server clock.
            ...(status === "settled" ? { settledAt: new Date(obj.created * 1000).toISOString() } : {}),
          },
        };
      } catch {
        // Try the next path.
      }
    }

    return {
      ok: false,
      live: false,
      detail: `Could not fetch status for transfer ${transferId}.`,
      data: { transferId, status: "pending" },
    };
  },
};
