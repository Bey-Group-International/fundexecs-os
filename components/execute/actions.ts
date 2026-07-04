"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext, requireOrgContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";
import { planRun, type CommitmentLike, type RunKind } from "@/lib/capital-ops";
import type { AssetType, Json } from "@/lib/supabase/database.types";

export interface CapitalOpResult {
  ok: boolean;
  error?: string;
}

// Best-effort map a deal's free-text asset class onto the asset_type enum so a
// promoted holding lands with a sensible type; falls back to "other".
function assetTypeFor(assetClass: string | null): AssetType {
  const v = (assetClass ?? "").toLowerCase();
  if (/real\s?estate|property|land|housing|industrial|logistics|office|retail/.test(v)) return "real_estate";
  if (/fund|lp interest|secondary/.test(v)) return "fund_interest";
  if (/venture|growth|tech|portfolio|startup|saas/.test(v)) return "portfolio_company";
  if (/buyout|operating|company|business|pe|control/.test(v)) return "operating_company";
  return "other";
}

// Execute › Closing: turn a closed deal into a portfolio holding in one click.
// Creates an asset seeded from the deal (name, type, cost = target amount, first
// mark = cost) and advances the deal to "owned" — the moment a deal becomes
// something to operate. Idempotent on re-click: if an asset already exists for
// the deal, it just ensures the stage is "owned". Both writes happen in one
// transaction via the promote_deal_to_asset RPC
// (20260703200000_deal_lifecycle_atomic.sql) — a failure between the insert
// and the stage update used to leave a deal marked "owned" with no matching
// holding, with nothing checking the Supabase client's error at either step.
export async function promoteDealToAsset(formData: FormData): Promise<CapitalOpResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const dealId = String(formData.get("deal_id") ?? "");
  if (!dealId) return { ok: false, error: "Missing deal." };

  const supabase = await createServerClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, asset_class")
    .eq("id", dealId)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();
  if (!deal) return { ok: false, error: "Deal not found." };

  const { error } = await supabase.rpc("promote_deal_to_asset", {
    p_org: auth.ctx.orgId,
    p_deal_id: dealId,
    p_asset_type: assetTypeFor(deal.asset_class),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/execute/closing");
  revalidatePath("/execute/asset_management");
  return { ok: true };
}

// --- Execute › agent actions ----------------------------------------------
// "Run with Earn" launchers for the fund-admin modules. Each kind seeds an Earn
// session whose prompt invokes the right agent on the firm's live books, then
// opens it — so the cap table, valuations, and waterfall aren't just views, the
// agent team works them. The engine routes to the named role.
const EARN_TASKS: Record<string, string> = {
  cap_statements:
    "Acting as Investor Relations: draft per-LP capital account statements from our cap table — committed, called, distributed, unfunded, NAV, and DPI/TVPI for each holder — in clean, LP-ready language.",
  cap_reconcile:
    "Acting as Portfolio Ops: reconcile our capital accounts against the commitments and capital-events ledger, flag any holder whose called/distributed totals don't tie out, and propose the correcting entries.",
  valuation_run:
    "Acting as the Analyst: run a fresh fair-value valuation pass across the portfolio — re-mark each holding from cost, NOI/cap rate, and comps; show the value bridge and a recommended NAV with rationale per asset.",
  valuation_asset:
    "Acting as the Analyst: produce a fair-value mark for this specific holding — method, key assumptions, comps, and a recommended current value with a short rationale.",
  waterfall_model:
    "Acting as Fund Admin: model a distribution waterfall for a proposed distribution — return of capital, preferred return, GP catch-up, and carry split — and give the per-LP allocation by ownership share.",
  tax_k1:
    "Acting as Fund Admin: prepare per-LP K-1 tax allocations for the year from our books — allocate ordinary income, capital gains, and expenses by ownership share, and roll each holder's tax capital account forward (beginning, contributions, distributions, allocated income, ending). Flag any estimate that needs a fund-administrator review.",
  exit_model:
    "Acting as the Analyst: model exit scenarios for the portfolio across a range of exit values — run each through the distribution waterfall and show gross MOIC, LP net multiple, and annualized IRR over the hold, plus the exit value at which LPs clear their preferred return.",
  valuation_409a:
    "Acting as the Analyst: produce a 409A-style fair-value conclusion for the portfolio — weigh the income, market, and cost approaches per holding, apply a defensible discount for lack of marketability where warranted, and reconcile the concluded value against the carried mark.",
  secondary_model:
    "Acting as Fund Admin: model a secondary transfer of an LP position — the committed, called, distributed, and unfunded amounts changing hands, the NAV share transferred, and the premium or discount to NAV the price implies — and show the resulting cap-table impact for both seller and buyer.",
};

export async function runWithEarn(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const kind = String(formData.get("kind") ?? "");
  let prompt = EARN_TASKS[kind];
  if (!prompt) redirect("/workspace");

  // Optional record context (e.g. a specific asset) for the per-item actions.
  const subject = String(formData.get("subject") ?? "").trim();
  if (subject) prompt += `\n\nSubject: ${subject}`;

  const supabase = await createServerClient();
  const result = await handlePrompt(
    { supabase, orgId: ctx.orgId, actorId: ctx.userId },
    prompt,
  );
  redirect(result.session_id ? `/session/${result.session_id}` : "/workspace");
}

// --- Investor portal: token-gated external statements ----------------------
// Mirrors the data-room share model. A share is a read-only link to one
// stakeholder's capital account, served by the public /portal/[token] route via
// the service role. Native — no external dependency.
export async function createInvestorPortalShare(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const investorId = String(formData.get("investor_id") ?? "");
  if (!investorId) return;
  const supabase = await createServerClient();
  // Reuse an existing live link if one exists; otherwise mint a new one.
  const { data: existing } = await supabase
    .from("investor_portal_shares")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("investor_id", investorId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!existing) {
    await supabase
      .from("investor_portal_shares")
      .insert({ organization_id: ctx.orgId, investor_id: investorId, created_by: ctx.userId });
  }
  revalidatePath("/execute/cap_table");
}

export async function revokeInvestorPortalShare(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createServerClient();
  await supabase
    .from("investor_portal_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath("/execute/cap_table");
}

// --- Valuations: record a fair-value mark (audit trail) --------------------
// Appends a mark to the valuation_marks history and rolls it onto the asset as
// the current value, so the latest mark and the full history stay in sync.
// Both writes happen in one transaction via the record_valuation_mark RPC
// (20260703200000_deal_lifecycle_atomic.sql) — a failure between the insert
// and the roll-up used to leave the audit trail and the asset's headline mark
// out of sync, with nothing checking the Supabase client's error at either step.
export async function recordValuationMark(formData: FormData): Promise<CapitalOpResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const assetId = String(formData.get("asset_id") ?? "");
  const raw = String(formData.get("value") ?? "").trim();
  const value = Number(raw);
  if (!assetId) return { ok: false, error: "Choose a holding." };
  if (raw === "" || !Number.isFinite(value)) return { ok: false, error: "Enter a valid fair value." };

  const asOf = String(formData.get("as_of") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const method = String(formData.get("method") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("record_valuation_mark", {
    p_org: auth.ctx.orgId,
    p_asset_id: assetId,
    p_value: value,
    p_as_of: asOf,
    p_method: method,
    p_note: note,
    p_created_by: auth.ctx.userId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/execute/valuations");
  return { ok: true };
}

// --- Agent-run capital operations (Tier 3 — always operator sign-off) -------
// Books a capital call or distribution RUN to the ledger: allocate across the
// fund's commitments pro-rata (planRun — pure, unit-tested TypeScript), then
// apply the whole write set (one capital_event per LP, each commitment's
// called/distributed amount, and the fund aggregate) in a single transaction
// via the capital_run_apply RPC (20260703180000_capital_ops_atomic.sql). A
// per-JS-write loop with no transaction used to mean a mid-run failure left
// some LPs booked and others not, with the fund aggregate rolled by the full
// planned total regardless — the RPC makes the whole run atomic, and its
// guarded increment re-validates the unfunded cap under lock (not the stale
// pre-transaction read the allocation was planned from) instead of silently
// over-calling an LP past their commitment. Capital movement is Tier 3 in the
// gate layer — never delegable — so this only runs on an explicit operator
// confirm (the UI previews the allocation first).
export async function recordCapitalRun(formData: FormData): Promise<CapitalOpResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const fundId = String(formData.get("fund_id") ?? "");
  const kind = String(formData.get("kind") ?? "") as RunKind;
  const amount = Number(String(formData.get("amount") ?? "").trim());
  if (!fundId || (kind !== "capital_call" && kind !== "distribution")) {
    return { ok: false, error: "Choose a fund and a run type." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a positive amount." };
  }

  const supabase = await createServerClient();
  const { data: fund } = await supabase
    .from("funds")
    .select("id")
    .eq("id", fundId)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();
  if (!fund) return { ok: false, error: "Fund not found." };

  const { data: commitRows } = await supabase
    .from("commitments")
    .select("id, investor_id, committed_amount, called_amount, distributed_amount")
    .eq("organization_id", auth.ctx.orgId)
    .eq("fund_id", fundId);
  const commitments = (commitRows ?? []) as CommitmentLike[];
  if (commitments.length === 0) return { ok: false, error: "This fund has no commitments to allocate across." };

  const plan = planRun(kind, commitments, amount);
  if (plan.totalAllocated <= 0) {
    return { ok: false, error: "Nothing could be allocated — check unfunded commitments." };
  }

  const today = new Date().toISOString().slice(0, 10);
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const allocations = plan.allocations
    .filter((a) => a.allocation > 0)
    .map((a) => ({ commitmentId: a.commitmentId, investorId: a.investorId, allocation: a.allocation }));

  const { error } = await supabase.rpc("capital_run_apply", {
    p_org: auth.ctx.orgId,
    p_fund_id: fundId,
    p_kind: kind,
    p_allocations: allocations as unknown as Json,
    p_reference: reference,
    p_effective_date: today,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/execute/capital_events");
  revalidatePath("/execute/cap_table");
  revalidatePath("/execute/ownership");
  return { ok: true };
}

// --- Secondary transfer (Tier 3 — always operator sign-off) ----------------
// Books an LP secondary: move a fraction of a seller's commitment to a buyer in
// the same fund. The whole transfer — reducing the seller's capital account
// (committed / called / distributed) and rolling the transferred amounts onto
// the buyer's commitment (creating it if the buyer is new to the fund) — runs
// in a single transaction via the capital_secondary_transfer RPC
// (20260703180000_capital_ops_atomic.sql), which locks the seller's row for
// the duration of the transfer and upserts the buyer's side atomically. The
// two separate JS read-then-write calls this used to be could lose an update
// under a concurrent transfer of the same position. A change of ownership is
// Tier 3 — never delegable — so this only runs on an explicit operator
// confirm (the UI previews the transfer and premium/discount to NAV first).
// The negotiated price is informational here: it changes hands between LPs,
// not on the fund's books.
export async function recordSecondaryTransfer(formData: FormData): Promise<CapitalOpResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const sellerCommitmentId = String(formData.get("seller_commitment_id") ?? "");
  const buyerInvestorId = String(formData.get("buyer_investor_id") ?? "");
  const fraction = Number(String(formData.get("fraction") ?? "").trim());
  if (!sellerCommitmentId || !buyerInvestorId) {
    return { ok: false, error: "Choose a seller position and a buyer." };
  }
  if (!Number.isFinite(fraction) || fraction <= 0) {
    return { ok: false, error: "Enter a positive fraction to transfer." };
  }
  const f = fraction >= 1 ? 1 : fraction;

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("capital_secondary_transfer", {
    p_org: auth.ctx.orgId,
    p_seller_commitment_id: sellerCommitmentId,
    p_buyer_investor_id: buyerInvestorId,
    p_fraction: f,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/execute/cap_table");
  revalidatePath("/execute/ownership");
  return { ok: true };
}
