"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";
import { planRun, type CommitmentLike, type RunKind } from "@/lib/capital-ops";
import type { AssetType } from "@/lib/supabase/database.types";

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
// the deal, it just ensures the stage is "owned".
export async function promoteDealToAsset(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const dealId = String(formData.get("deal_id") ?? "");
  if (!dealId) return;

  const supabase = createServerClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, name, asset_class, target_amount, fund_id, stage")
    .eq("id", dealId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!deal) return;

  const { data: existing } = await supabase
    .from("assets")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("deal_id", deal.id)
    .maybeSingle();

  if (!existing) {
    const cost = typeof deal.target_amount === "number" ? deal.target_amount : null;
    await supabase.from("assets").insert({
      organization_id: ctx.orgId,
      deal_id: deal.id,
      fund_id: deal.fund_id,
      name: deal.name,
      asset_type: assetTypeFor(deal.asset_class),
      acquisition_date: new Date().toISOString().slice(0, 10),
      acquisition_cost: cost,
      current_value: cost, // first mark = cost basis
      status: "active",
    });
  }

  await supabase
    .from("deals")
    .update({ stage: "owned" })
    .eq("id", deal.id)
    .eq("organization_id", ctx.orgId);

  revalidatePath("/execute/closing");
  revalidatePath("/execute/asset_management");
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

  const supabase = createServerClient();
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
  const supabase = createServerClient();
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
  const supabase = createServerClient();
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
export async function recordValuationMark(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const assetId = String(formData.get("asset_id") ?? "");
  const raw = String(formData.get("value") ?? "").trim();
  const value = Number(raw);
  if (!assetId || raw === "" || !Number.isFinite(value)) return;

  const asOf = String(formData.get("as_of") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const method = String(formData.get("method") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  const supabase = createServerClient();
  await supabase.from("valuation_marks").insert({
    organization_id: ctx.orgId,
    asset_id: assetId,
    value,
    as_of: asOf,
    method,
    note,
    created_by: ctx.userId,
  });
  // Latest mark becomes the asset's current value.
  await supabase
    .from("assets")
    .update({ current_value: value })
    .eq("id", assetId)
    .eq("organization_id", ctx.orgId);

  revalidatePath("/execute/valuations");
}

// --- Agent-run capital operations (Tier 3 — always operator sign-off) -------
// Books a capital call or distribution RUN to the ledger: allocate across the
// fund's commitments pro-rata (planRun), write one capital_event per LP, and
// roll the amounts onto the commitments and the fund. Capital movement is Tier
// 3 in the gate layer — never delegable — so this only runs on an explicit
// operator confirm (the UI previews the allocation first).
export async function recordCapitalRun(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const fundId = String(formData.get("fund_id") ?? "");
  const kind = String(formData.get("kind") ?? "") as RunKind;
  const amount = Number(String(formData.get("amount") ?? "").trim());
  if (!fundId || (kind !== "capital_call" && kind !== "distribution")) return;
  if (!Number.isFinite(amount) || amount <= 0) return;

  const supabase = createServerClient();
  const { data: fund } = await supabase
    .from("funds")
    .select("id, called_capital, distributed_capital")
    .eq("id", fundId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!fund) return;

  const { data: commitRows } = await supabase
    .from("commitments")
    .select("id, investor_id, committed_amount, called_amount, distributed_amount")
    .eq("organization_id", ctx.orgId)
    .eq("fund_id", fundId);
  const commitments = (commitRows ?? []) as CommitmentLike[];
  if (commitments.length === 0) return;

  const plan = planRun(kind, commitments, amount);
  if (plan.totalAllocated <= 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const byId = new Map(commitments.map((c) => [c.id, c]));

  for (const a of plan.allocations) {
    if (a.allocation <= 0) continue;
    await supabase.from("capital_events").insert({
      organization_id: ctx.orgId,
      fund_id: fundId,
      investor_id: a.investorId,
      event_type: kind,
      amount: a.allocation,
      currency: "USD",
      effective_date: today,
      reference,
    });
    const c = byId.get(a.commitmentId)!;
    if (kind === "capital_call") {
      await supabase
        .from("commitments")
        .update({ called_amount: (c.called_amount ?? 0) + a.allocation })
        .eq("id", a.commitmentId)
        .eq("organization_id", ctx.orgId);
    } else {
      await supabase
        .from("commitments")
        .update({ distributed_amount: (c.distributed_amount ?? 0) + a.allocation })
        .eq("id", a.commitmentId)
        .eq("organization_id", ctx.orgId);
    }
  }

  // Roll the fund aggregate so the command center (which prefers fund totals)
  // stays consistent with the per-LP ledger.
  if (kind === "capital_call") {
    await supabase
      .from("funds")
      .update({ called_capital: (fund.called_capital ?? 0) + plan.totalAllocated })
      .eq("id", fundId)
      .eq("organization_id", ctx.orgId);
  } else {
    await supabase
      .from("funds")
      .update({ distributed_capital: (fund.distributed_capital ?? 0) + plan.totalAllocated })
      .eq("id", fundId)
      .eq("organization_id", ctx.orgId);
  }

  revalidatePath("/execute/capital_events");
  revalidatePath("/execute/cap_table");
  revalidatePath("/execute/ownership");
}
