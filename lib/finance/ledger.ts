// lib/finance/ledger.ts
// FundExecs Finance Engine — Phase 1: the double-entry ledger domain core.
//
// Pure, framework-free logic (no DB, no I/O) so it is unit-tested directly and
// reused by the server actions. Signed-amount convention: debit > 0, credit < 0;
// a balanced entry sums to zero in base currency. Money is carried as a number
// rounded to 4dp to mirror the numeric(20,4) columns.
import { createHash } from "crypto";
import type { ActionKind } from "@/lib/gates";

export type Money = number;

/** Round to 4 decimal places (the ledger's numeric(20,4) scale). */
export const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

export interface JournalLineInput {
  accountId: string;
  // Signed transaction-currency amount: positive = debit, negative = credit.
  amount: Money;
  currency: string;
  // Signed base-currency amount; defaults to amount * fxRate when omitted.
  baseAmount?: Money;
  fxRate?: number;
  memo?: string;
}

export interface NormalizedLine {
  accountId: string;
  lineNo: number;
  currency: string;
  amount: Money;
  baseAmount: Money;
  fxRate: number;
  memo?: string;
}

export interface BalanceCheck {
  balanced: boolean;
  imbalance: Money;
  lineCount: number;
}

/**
 * A posted entry must have ≥2 lines and its base amounts must net to zero. This
 * is the double-entry invariant the app enforces before writing; the database
 * has its own deferred constraint trigger as the final guarantee.
 */
export function assertBalanced(lines: { baseAmount: Money }[]): BalanceCheck {
  const imbalance = round4(lines.reduce((sum, l) => sum + l.baseAmount, 0));
  return { balanced: imbalance === 0 && lines.length >= 2, imbalance, lineCount: lines.length };
}

/** Assign line numbers and derive base amounts / rounding. Pure. */
export function normalizeLines(input: JournalLineInput[]): NormalizedLine[] {
  return input.map((l, i) => {
    const fxRate = l.fxRate ?? 1;
    const amount = round4(l.amount);
    const baseAmount = round4(l.baseAmount ?? amount * fxRate);
    return { accountId: l.accountId, lineNo: i + 1, currency: l.currency, amount, baseAmount, fxRate, memo: l.memo };
  });
}

/** Trial balance: net base amount per account (debits positive, credits negative). */
export function computeTrialBalance(lines: { accountId: string; baseAmount: Money }[]): Map<string, Money> {
  const balances = new Map<string, Money>();
  for (const l of lines) {
    balances.set(l.accountId, round4((balances.get(l.accountId) ?? 0) + l.baseAmount));
  }
  return balances;
}

/**
 * The gate action a post represents, by the target period's status. Posting into
 * an open period is routine internal bookkeeping (Tier 1); forcing a post into a
 * closed/locked period is a Tier-3 control that needs the operator.
 */
export function postingAction(periodStatus: "open" | "closed" | "locked"): ActionKind {
  return periodStatus === "open" ? "post_journal_entry" : "post_to_closed_period";
}

// The minimal shape needed to reverse a line — satisfied by both a NormalizedLine
// and a raw row read back from the ledger.
export interface ReversibleLine {
  accountId: string;
  amount: Money;
  baseAmount: Money;
  currency: string;
  fxRate?: number;
  memo?: string;
}

/**
 * The reversing lines for an entry: same accounts, opposite signs. A correction
 * never mutates a posted entry — it posts this counter-entry.
 */
export function reversalLines(lines: ReversibleLine[]): JournalLineInput[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    amount: round4(-l.amount),
    currency: l.currency,
    baseAmount: round4(-l.baseAmount),
    fxRate: l.fxRate ?? 1,
    memo: l.memo,
  }));
}

/**
 * Tamper-evident hash chain: sha256 over the canonical entry payload plus the
 * prior entry's hash, so any retro-edit of ledger history is detectable.
 */
export function entryHash(
  prevHash: string | null,
  payload: { ledgerId: string; entryNo: number; entryDate: string; lines: NormalizedLine[] },
): string {
  const canonical = JSON.stringify({
    prev: prevHash ?? "",
    ledgerId: payload.ledgerId,
    entryNo: payload.entryNo,
    entryDate: payload.entryDate,
    lines: payload.lines.map((l) => [l.accountId, l.amount, l.baseAmount, l.currency]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
