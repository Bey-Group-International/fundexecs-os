"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import {
  detectFormat,
  parseStatement,
  dedupHash,
  categorize,
  autoMatch,
  type ImportFormat,
  type NormalizedBankTxn,
  type TxnRule,
  type EntryCandidate,
} from "@/lib/finance/banking";
import type { FinTxnRule, Json } from "@/lib/supabase/database.types";
import { postJournalEntry } from "../actions";

export interface BankResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// --- Setup: bank accounts ----------------------------------------------------

/** Register a bank account and map it to its GL cash account (Tier 1). */
export async function createBankAccount(input: {
  entityId: string;
  glAccountId: string;
  name: string;
  institution?: string;
  accountNumber?: string;
  currency: string;
}): Promise<BankResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const currency = (input.currency ?? "").trim().toUpperCase();
  if (!input.entityId || !input.glAccountId || !input.name?.trim() || !/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Entity, GL account, name, and a 3-letter currency are required." };
  }
  // Store only the last 4 of any account number — never the full PAN.
  const mask = input.accountNumber ? input.accountNumber.replace(/\s+/g, "").slice(-4) : null;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("fin_bank_accounts")
    .insert({
      organization_id: auth.ctx.orgId,
      entity_id: input.entityId,
      gl_account_id: input.glAccountId,
      name: input.name.trim(),
      institution: input.institution?.trim() || null,
      account_mask: mask,
      currency,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create bank account." };
  revalidatePath("/finance");
  return { ok: true, data: { id: data.id } };
}

// --- Import: parse a statement file and stage its transactions (Tier 1) ------

const ruleToDomain = (r: FinTxnRule): TxnRule => ({
  id: r.id,
  priority: r.priority,
  matchType: r.match_type,
  matchField: r.match_field === "counterparty" ? "counterparty" : "description",
  pattern: r.pattern,
  amountMin: r.amount_min,
  amountMax: r.amount_max,
  targetAccountId: r.target_account_id,
  counterparty: r.counterparty,
  isActive: r.is_active,
});

/**
 * Import a bank statement file: detect the format, parse it, auto-categorize
 * each line against the entity's rules, and stage the transactions (dedup by a
 * stable per-account hash so a re-import is idempotent).
 */
export async function importBankFile(input: {
  bankAccountId: string;
  fileText: string;
  format?: ImportFormat;
  filename?: string;
}): Promise<BankResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (!input.bankAccountId || !input.fileText?.trim()) {
    return { ok: false, error: "A bank account and a non-empty file are required." };
  }
  // Guard against pathologically large uploads before parsing the whole file.
  const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
  if (input.fileText.length > MAX_FILE_BYTES) {
    return { ok: false, error: "Statement file must be under 10 MB." };
  }
  const format = input.format ?? detectFormat(input.fileText);
  if (!format) return { ok: false, error: "Could not detect the statement format (CSV/OFX/QIF/CAMT)." };

  const supabase = createServerClient();
  const { data: account } = await supabase
    .from("fin_bank_accounts")
    .select("id, entity_id, currency")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", input.bankAccountId)
    .maybeSingle();
  if (!account) return { ok: false, error: "Bank account not found." };
  const acct = account as { entity_id: string; currency: string };

  const parsed = parseStatement(format, input.fileText, acct.currency);
  if (!parsed.txns.length) return { ok: false, error: "No transactions found in the file." };

  // Load the entity's active categorization rules once.
  const { data: ruleRows } = await supabase
    .from("fin_txn_rules")
    .select("*")
    .eq("organization_id", auth.ctx.orgId)
    .eq("entity_id", acct.entity_id)
    .eq("is_active", true);
  const rules = ((ruleRows ?? []) as FinTxnRule[]).map(ruleToDomain);

  // Record the import batch first so each staged row can reference it.
  const checksum = createHash("sha256").update(input.fileText).digest("hex");
  const dates = parsed.txns.map((t) => t.date).sort();
  const { data: importRow, error: importErr } = await supabase
    .from("fin_bank_imports")
    .insert({
      organization_id: auth.ctx.orgId,
      bank_account_id: input.bankAccountId,
      format,
      filename: input.filename ?? null,
      checksum,
      row_count: parsed.txns.length,
      status: "pending",
      statement_start: parsed.statementStart ?? dates[0] ?? null,
      statement_end: parsed.statementEnd ?? dates[dates.length - 1] ?? null,
      opening_balance: parsed.openingBalance ?? null,
      closing_balance: parsed.closingBalance ?? null,
      imported_by: auth.ctx.userId,
    })
    .select("id")
    .single();
  if (importErr || !importRow) {
    return { ok: false, error: importErr?.message ?? "Could not record the import." };
  }

  // Stage each transaction, deduped by (bank_account_id, dedup_hash).
  const rows = parsed.txns.map((t: NormalizedBankTxn) => {
    const cat = categorize(t, rules);
    return {
      organization_id: auth.ctx.orgId,
      bank_account_id: input.bankAccountId,
      import_id: importRow.id,
      txn_date: t.date,
      value_date: t.valueDate ?? null,
      amount: t.amount,
      currency: t.currency,
      description: t.description || null,
      counterparty: t.counterparty ?? cat?.counterparty ?? null,
      external_ref: t.externalRef ?? null,
      running_balance: t.runningBalance ?? null,
      dedup_hash: dedupHash(input.bankAccountId, t),
      status: cat ? ("suggested" as const) : ("unmatched" as const),
      suggested_account_id: cat?.accountId ?? null,
    };
  });

  const { data: inserted, error: stageErr } = await supabase
    .from("fin_bank_transactions")
    .upsert(rows, { onConflict: "bank_account_id,dedup_hash", ignoreDuplicates: true })
    .select("id");
  if (stageErr) {
    await supabase.from("fin_bank_imports").update({ status: "failed" }).eq("id", importRow.id);
    return { ok: false, error: stageErr.message };
  }

  const staged = inserted?.length ?? 0;
  const duplicates = parsed.txns.length - staged;
  await supabase
    .from("fin_bank_imports")
    .update({ status: "staged", staged_count: staged, duplicate_count: duplicates })
    .eq("id", importRow.id);

  revalidatePath("/finance");
  return {
    ok: true,
    data: { importId: importRow.id, format, parsed: parsed.txns.length, staged, duplicates },
  };
}

// --- Reconciliation ----------------------------------------------------------

/**
 * Reconcile a staged transaction: either link it to an existing journal entry,
 * or post a new balanced entry from a coding (bank GL vs a counter account) and
 * link that. The staged txn is marked 'reconciled' with an audit row (Tier 1).
 */
export async function matchTransaction(input: {
  bankTxnId: string;
  entryId?: string;
  newCoding?: { ledgerId: string; periodId: string; counterAccountId: string; memo?: string };
}): Promise<BankResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();

  const { data: txnRow } = await supabase
    .from("fin_bank_transactions")
    .select("id, amount, currency, txn_date, status, bank_account_id")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", input.bankTxnId)
    .maybeSingle();
  if (!txnRow) return { ok: false, error: "Bank transaction not found." };
  const txn = txnRow as {
    amount: number;
    currency: string;
    txn_date: string;
    status: string;
    bank_account_id: string;
  };
  if (txn.status === "reconciled") return { ok: false, error: "Transaction is already reconciled." };

  let entryId = input.entryId;

  if (!entryId && input.newCoding) {
    // Post a balanced 2-line entry: bank GL takes the signed txn amount (a
    // deposit debits cash), the counter account takes the opposite side.
    const { data: account } = await supabase
      .from("fin_bank_accounts")
      .select("gl_account_id")
      .eq("organization_id", auth.ctx.orgId)
      .eq("id", txn.bank_account_id)
      .maybeSingle();
    if (!account) return { ok: false, error: "Bank account not found." };
    const glAccountId = (account as { gl_account_id: string }).gl_account_id;
    const posted = await postJournalEntry({
      ledgerId: input.newCoding.ledgerId,
      periodId: input.newCoding.periodId,
      entryDate: txn.txn_date,
      memo: input.newCoding.memo ?? "Bank reconciliation",
      lines: [
        { accountId: glAccountId, amount: txn.amount, currency: txn.currency },
        { accountId: input.newCoding.counterAccountId, amount: -txn.amount, currency: txn.currency },
      ],
    });
    if (!posted.ok) return { ok: false, error: posted.error ?? "Could not post the coding entry." };
    entryId = (posted.data as { entryId: string }).entryId;
  }

  if (!entryId) return { ok: false, error: "Provide an entry to match, or a coding to post." };
  const linked = await applyReconciliations(
    supabase,
    auth.ctx.userId,
    [{ txnId: input.bankTxnId, entryId }],
    "manual",
  );
  if (!linked.ok || linked.count < 1) {
    // The link (insert + status flip) is atomic, so nothing half-applies here.
    // But a coding entry may already have been posted in the step above — surface
    // it explicitly so the operator can relink or reverse it, never orphan it.
    const orphan = input.newCoding
      ? ` A journal entry (${entryId}) was posted but not linked — reverse or relink it.`
      : "";
    return { ok: false, error: `Could not link the reconciliation.${orphan}` };
  }
  return { ok: true, data: { bankTxnId: input.bankTxnId, entryId, matchKind: "manual" } };
}

// Apply a batch of (txn, entry) reconciliations atomically via the RPC: each
// pair's audit-row insert and bank-txn status flip happen in one transaction,
// so a link can never half-apply. One round-trip for the whole batch.
async function applyReconciliations(
  supabase: ReturnType<typeof createServerClient>,
  actorId: string,
  pairs: { txnId: string; entryId: string }[],
  matchKind: "auto" | "manual",
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!pairs.length) return { ok: true, count: 0 };
  const { data, error } = await supabase.rpc("fin_reconcile_txns", {
    p_pairs: pairs as unknown as Json,
    p_match_kind: matchKind,
    p_actor: actorId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/finance");
  return { ok: true, count: (data as number) ?? 0 };
}

/**
 * Reconciliation bot: for each unmatched transaction on an account, auto-match
 * the single posted entry whose bank-GL line equals the amount within a small
 * date window. Ambiguous transactions are left for manual review.
 */
export async function autoReconcile(input: {
  bankAccountId: string;
  windowDays?: number;
}): Promise<BankResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();

  const { data: account } = await supabase
    .from("fin_bank_accounts")
    .select("gl_account_id")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", input.bankAccountId)
    .maybeSingle();
  if (!account) return { ok: false, error: "Bank account not found." };
  const glAccountId = (account as { gl_account_id: string }).gl_account_id;

  const { data: txnRows } = await supabase
    .from("fin_bank_transactions")
    .select("id, amount, txn_date")
    .eq("organization_id", auth.ctx.orgId)
    .eq("bank_account_id", input.bankAccountId)
    .eq("status", "unmatched");
  const unmatched = (txnRows ?? []) as { id: string; amount: number; txn_date: string }[];
  if (!unmatched.length) return { ok: true, data: { matched: 0 } };

  // Posted entries with a line on the bank's GL account (status filtered in SQL),
  // excluding any already reconciled.
  const { data: lineRows } = await supabase
    .from("fin_journal_lines")
    .select("amount, entry:fin_journal_entries!inner(id, entry_date)")
    .eq("organization_id", auth.ctx.orgId)
    .eq("account_id", glAccountId)
    .eq("fin_journal_entries.status", "posted");
  const { data: reconRows } = await supabase
    .from("fin_reconciliations")
    .select("entry_id")
    .eq("organization_id", auth.ctx.orgId)
    .eq("bank_account_id", input.bankAccountId);
  const usedEntries = new Set((reconRows ?? []).map((r) => (r as { entry_id: string }).entry_id));

  const candidates: EntryCandidate[] = ((lineRows ?? []) as unknown as {
    amount: number;
    entry: { id: string; entry_date: string } | null;
  }[])
    .filter((l) => l.entry && !usedEntries.has(l.entry.id))
    .map((l) => ({ entryId: l.entry!.id, entryDate: l.entry!.entry_date, bankLineAmount: l.amount }));

  // Collect all unambiguous matches, then apply them in a single atomic batch.
  const claimed = new Set<string>();
  const pairs: { txnId: string; entryId: string }[] = [];
  for (const t of unmatched) {
    const pool = candidates.filter((c) => !claimed.has(c.entryId));
    const hit = autoMatch(
      { date: t.txn_date, amount: t.amount, currency: "", description: "" },
      pool,
      input.windowDays ?? 3,
    );
    if (!hit) continue;
    claimed.add(hit);
    pairs.push({ txnId: t.id, entryId: hit });
  }
  const applied = await applyReconciliations(supabase, auth.ctx.userId, pairs, "auto");
  if (!applied.ok) return { ok: false, error: applied.error };
  return { ok: true, data: { matched: applied.count, scanned: unmatched.length } };
}

/** Create an auto-categorization rule for an entity (Tier 1). */
export async function createCategorizationRule(input: {
  entityId: string;
  name: string;
  pattern: string;
  targetAccountId: string;
  matchType?: "contains" | "exact" | "regex";
  matchField?: "description" | "counterparty";
  priority?: number;
  amountMin?: number;
  amountMax?: number;
  counterparty?: string;
}): Promise<BankResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (!input.entityId || !input.name?.trim() || !input.pattern?.trim() || !input.targetAccountId) {
    return { ok: false, error: "Entity, name, pattern, and target account are required." };
  }
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("fin_txn_rules")
    .insert({
      organization_id: auth.ctx.orgId,
      entity_id: input.entityId,
      name: input.name.trim(),
      pattern: input.pattern.trim(),
      target_account_id: input.targetAccountId,
      match_type: input.matchType ?? "contains",
      match_field: input.matchField ?? "description",
      priority: input.priority ?? 100,
      amount_min: input.amountMin ?? null,
      amount_max: input.amountMax ?? null,
      counterparty: input.counterparty?.trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create rule." };
  revalidatePath("/finance");
  return { ok: true, data: { id: data.id } };
}
