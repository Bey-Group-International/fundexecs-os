"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { gateDecision } from "@/lib/gates";
import { getActiveMandate } from "@/lib/mandates";
import {
  normalizeLines,
  assertBalanced,
  postingAction,
  reversalLines,
  type JournalLineInput,
} from "@/lib/finance/ledger";
import type {
  FinAccountType,
  FinJournalLine,
  FinPeriodStatus,
  Json,
} from "@/lib/supabase/database.types";

export interface FinResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  gated?: boolean;
  tier?: 1 | 2 | 3;
}

// --- Setup: entities & accounts ---------------------------------------------

export async function createEntity(input: {
  name: string;
  baseCurrency: string;
  parentEntityId?: string;
  taxJurisdiction?: string;
}): Promise<FinResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  // Normalize first, then validate, so the checked and the stored value match.
  const baseCurrency = (input.baseCurrency ?? "").trim().toUpperCase();
  if (!input.name?.trim() || !/^[A-Z]{3}$/.test(baseCurrency)) {
    return { ok: false, error: "Name and a 3-letter base currency are required." };
  }
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("fin_entities")
    .insert({
      organization_id: auth.ctx.orgId,
      name: input.name.trim(),
      base_currency: baseCurrency,
      parent_entity_id: input.parentEntityId ?? null,
      tax_jurisdiction: input.taxJurisdiction ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create entity." };
  revalidatePath("/finance");
  return { ok: true, data: { id: data.id } };
}

export async function createAccount(input: {
  entityId: string;
  code: string;
  name: string;
  type: FinAccountType;
  parentAccountId?: string;
  isControl?: boolean;
}): Promise<FinResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (!input.entityId || !input.code?.trim() || !input.name?.trim()) {
    return { ok: false, error: "Entity, code, and name are required." };
  }
  // Normal side follows the statement type: assets & expenses are debit-normal.
  const normalSide = input.type === "asset" || input.type === "expense" ? "debit" : "credit";
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("fin_accounts")
    .insert({
      organization_id: auth.ctx.orgId,
      entity_id: input.entityId,
      code: input.code.trim(),
      name: input.name.trim(),
      type: input.type,
      normal_side: normalSide,
      parent_account_id: input.parentAccountId ?? null,
      is_control: input.isControl ?? false,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create account." };
  revalidatePath("/finance");
  return { ok: true, data: { id: data.id } };
}

// --- Posting -----------------------------------------------------------------

async function postToLedger(
  auth: { ctx: { orgId: string; userId: string } },
  args: {
    ledgerId: string;
    periodId: string;
    entryDate: string;
    memo?: string;
    source?: string;
    sourceRef?: string;
    reverses?: string;
    lines: JournalLineInput[];
  },
): Promise<FinResult> {
  const supabase = createServerClient();

  const lines = normalizeLines(args.lines);
  const balance = assertBalanced(lines);
  if (!balance.balanced) {
    return {
      ok: false,
      error:
        balance.lineCount < 2
          ? "A journal entry needs at least two lines."
          : `Entry is not balanced (base Σ = ${balance.imbalance}).`,
    };
  }

  // Resolve the target period's status → which gated action this post is.
  const { data: period } = await supabase
    .from("fin_periods")
    .select("status")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", args.periodId)
    .maybeSingle();
  if (!period) return { ok: false, error: "Accounting period not found." };
  const action = postingAction((period as { status: FinPeriodStatus }).status);

  // Gate: posting into an open period is Tier-1 (free); forcing a post into a
  // closed/locked period is Tier-3 and routes to the operator's approvals.
  const mandate = await getActiveMandate(supabase, auth.ctx.orgId);
  const decision = gateDecision(action, mandate);
  if (decision.requiresApproval) {
    const { data: task } = await supabase
      .from("tasks")
      .insert({
        organization_id: auth.ctx.orgId,
        title: `Post to a closed period — ${args.memo ?? args.entryDate}`,
        description: `Force-post a journal entry into a closed accounting period on ledger ${args.ledgerId}.`,
        // Capital/compliance control lives in the Execute hub, not deal sourcing.
        hub: "execute",
        assigned_agent: "fund_admin",
        status: "awaiting_approval",
        progress: 0,
        graph_touched: "capital",
        requires_approval: true,
        created_by: auth.ctx.userId,
        step_order: 0,
      })
      .select("id")
      .single();
    if (task) {
      await supabase.from("approvals").insert({
        organization_id: auth.ctx.orgId,
        task_id: task.id,
        requested_by_agent: "fund_admin",
        summary: `Tier 3 — force-post into a closed period`,
      });
    }
    revalidatePath("/finance");
    return {
      ok: true,
      gated: true,
      tier: decision.tier,
      data: { taskId: task?.id },
    };
  }

  // Free to post: one atomic RPC (bump sequence, insert entry + lines).
  const { data: entryId, error } = await supabase.rpc("fin_post_journal_entry", {
    p_ledger: args.ledgerId,
    p_period: args.periodId,
    p_entry_date: args.entryDate,
    p_memo: args.memo ?? null,
    p_source: args.source ?? "manual",
    p_source_ref: args.sourceRef ?? null,
    p_reverses: args.reverses ?? null,
    p_lines: lines.map((l) => ({
      accountId: l.accountId,
      currency: l.currency,
      amount: l.amount,
      baseAmount: l.baseAmount,
      fxRate: l.fxRate,
      memo: l.memo ?? null,
    })) as unknown as Json,
    p_actor: auth.ctx.userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/finance");
  return { ok: true, tier: decision.tier, data: { entryId } };
}

/** Post a balanced journal entry to a ledger (Tier-1 in an open period). */
export async function postJournalEntry(args: {
  ledgerId: string;
  periodId: string;
  entryDate: string;
  memo?: string;
  lines: JournalLineInput[];
}): Promise<FinResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  return postToLedger(auth, args);
}

/**
 * Reverse a posted entry: post its mirror (opposite signs) then mark the
 * original 'reversed'. The original is never mutated in place — the correction
 * is its own entry, preserving the immutable audit trail.
 */
export async function reverseJournalEntry(args: {
  entryId: string;
  entryDate: string;
  memo?: string;
}): Promise<FinResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();

  const { data: entry } = await supabase
    .from("fin_journal_entries")
    .select("id, ledger_id, period_id, status")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", args.entryId)
    .maybeSingle();
  if (!entry) return { ok: false, error: "Entry not found." };
  if ((entry as { status: string }).status !== "posted") {
    return { ok: false, error: "Only a posted entry can be reversed." };
  }

  const { data: lineRows } = await supabase
    .from("fin_journal_lines")
    .select("account_id, currency, amount, base_amount, fx_rate, memo")
    .eq("organization_id", auth.ctx.orgId)
    .eq("entry_id", args.entryId)
    .order("line_no", { ascending: true });
  const original = (lineRows ?? []) as Pick<
    FinJournalLine,
    "account_id" | "currency" | "amount" | "base_amount" | "fx_rate" | "memo"
  >[];
  if (!original.length) return { ok: false, error: "Entry has no lines." };

  const e = entry as { ledger_id: string; period_id: string };
  const reversal = reversalLines(
    original.map((l) => ({
      accountId: l.account_id,
      amount: l.amount,
      currency: l.currency,
      baseAmount: l.base_amount,
      fxRate: l.fx_rate,
      memo: l.memo ?? undefined,
    })),
  );

  // The RPC posts the reversal AND flips the original to 'reversed' atomically
  // (guarded by a row lock + a unique index on reverses_entry_id), so there is no
  // separate, non-atomic status update here and no double-reversal race.
  return postToLedger(auth, {
    ledgerId: e.ledger_id,
    periodId: e.period_id,
    entryDate: args.entryDate,
    memo: args.memo ?? `Reversal of ${args.entryId}`,
    source: "reversal",
    reverses: args.entryId,
    lines: reversal,
  });
}
