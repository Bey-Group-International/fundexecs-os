// lib/finance/banking.ts
// FundExecs Finance Engine — Phase 2: the banking domain core.
//
// Pure, framework-free logic (no DB, no I/O): statement-file parsing for the
// four common formats, a stable dedup hash, auto-categorization rule matching,
// and reconciliation candidate matching. The server actions and the pluggable
// import-adapter seam (lib/finance/import) reuse this, and it is unit-tested
// directly. Amount convention: money IN (deposit) is positive, money OUT is
// negative — the same sign the bank line takes on the cash GL account.
import { createHash } from "crypto";
import { round4, type Money } from "./ledger";

export type ImportFormat = "csv" | "ofx" | "qif" | "camt";

/** A bank transaction normalized across all import formats. */
export interface NormalizedBankTxn {
  // ISO date (YYYY-MM-DD) the transaction posted.
  date: string;
  // ISO value/settlement date, when the file distinguishes it.
  valueDate?: string;
  // Signed amount in the statement currency: deposit > 0, withdrawal < 0.
  amount: Money;
  currency: string;
  description: string;
  counterparty?: string;
  // The bank's own stable reference (OFX FITID, CAMT AcctSvcrRef, …) when present.
  externalRef?: string;
  runningBalance?: Money;
}

export interface ParsedStatement {
  txns: NormalizedBankTxn[];
  openingBalance?: Money;
  closingBalance?: Money;
  statementStart?: string;
  statementEnd?: string;
}

// --- Format detection --------------------------------------------------------

/** Sniff the statement format from the file's content. Null if unrecognized. */
export function detectFormat(text: string): ImportFormat | null {
  const head = text.slice(0, 4096);
  const trimmed = head.trimStart();
  if (/OFXHEADER|<OFX>/i.test(head)) return "ofx";
  if (/^!Type:/im.test(head) || /^!Type/i.test(trimmed)) return "qif";
  if (/<Document[\s>]/i.test(head) && /camt\.05\d/i.test(head)) return "camt";
  if (trimmed.startsWith("<?xml") && /<(Ntry|BkToCstmrStmt)[\s>]/i.test(head)) return "camt";
  // Fall back to CSV when the head has a comma-delimited first row.
  if (/[^\n]*,[^\n]*/.test(head)) return "csv";
  return null;
}

// --- Shared helpers ----------------------------------------------------------

/** Parse a money string ("1,234.56", "(50.00)", "-12.3") to a signed number. */
export function parseAmount(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let sign = 1;
  // Accounting parentheses denote a negative.
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    sign = -sign;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  // Strip currency symbols and thousands separators; keep the decimal point.
  s = s.replace(/[^0-9.,]/g, "");
  if (!/\d/.test(s)) return null; // no digits survived → not a number

  // If both separators appear, the last one is the decimal separator.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    const dec = lastComma > lastDot ? "," : ".";
    const thou = dec === "," ? "." : ",";
    s = s.split(thou).join("");
    if (dec === ",") s = s.replace(",", ".");
  } else if (lastComma > -1) {
    // Only commas: treat as decimal if it looks like one (comma then ≤2 digits).
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.split(",").join("");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return round4(sign * n);
}

export type DateLocale = "us" | "eu";

/**
 * Normalize a date token from any supported format to ISO YYYY-MM-DD. Compact
 * (YYYYMMDD) and ISO forms are unambiguous; for slashed D/M/Y vs M/D/Y the field
 * that is > 12 disambiguates, and when both are ≤ 12 the `locale` decides
 * (US → month-first, EU → day-first). CSV/QIF from European banks must pass
 * "eu" or a `02/07/2026` will silently parse as Feb 7 instead of 2 July.
 */
export function normalizeDate(
  raw: string | undefined | null,
  locale: DateLocale = "us",
): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  // OFX/CAMT compact timestamp: YYYYMMDD[HHMMSS][...]
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  // ISO (possibly with time).
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Slashed D/M/Y or M/D/Y.
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    let [, a, b, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    let mon: string;
    let day: string;
    if (Number(a) > 12 && Number(b) <= 12) {
      day = a; // first field must be the day
      mon = b;
    } else if (Number(b) > 12 && Number(a) <= 12) {
      mon = a; // second field must be the day
      day = b;
    } else if (locale === "eu") {
      day = a; // ambiguous → day-first
      mon = b;
    } else {
      mon = a; // ambiguous → month-first (default)
      day = b;
    }
    return `${y}-${mon.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return undefined;
}

/** Split one CSV line into fields, honoring double-quoted values with commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const firstTag = (block: string, tag: string): string | undefined => {
  // Match <tag>value up to the next tag or newline (OFX/SGML) OR a closed
  // <tag>value</tag> (XML), ignoring any namespace prefix.
  const re = new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<\\r\\n]*)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : undefined;
};

// --- CSV ---------------------------------------------------------------------

const COLUMN_ALIASES: Record<string, string[]> = {
  date: ["date", "transaction date", "posted date", "post date", "booking date"],
  valueDate: ["value date", "settlement date"],
  description: ["description", "details", "memo", "narrative", "particulars", "reference", "payee"],
  amount: ["amount", "value"],
  debit: ["debit", "withdrawal", "money out", "paid out", "dr"],
  credit: ["credit", "deposit", "money in", "paid in", "cr"],
  balance: ["balance", "running balance"],
  currency: ["currency", "ccy"],
  counterparty: ["counterparty", "payee", "merchant", "name"],
  externalRef: ["reference", "ref", "transaction id", "fitid"],
};

const matchColumn = (header: string): string | null => {
  const h = header.toLowerCase().trim();
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(h)) return key;
  }
  return null;
};

/** Parse a delimited (CSV) statement using a fuzzy header→field mapping. */
export function parseCsv(text: string, defaultCurrency = "USD", locale: DateLocale = "us"): ParsedStatement {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { txns: [] };
  const header = splitCsvLine(lines[0]);
  const colMap = header.map(matchColumn);
  const txns: NormalizedBankTxn[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r]);
    const get = (field: string): string | undefined => {
      const idx = colMap.indexOf(field);
      return idx > -1 ? cells[idx] : undefined;
    };
    const date = normalizeDate(get("date"), locale);
    if (!date) continue; // skip non-transaction rows (totals, blanks)
    let amount = parseAmount(get("amount"));
    if (amount == null) {
      // Debit/Credit column pair → deposit positive, withdrawal negative.
      const debit = parseAmount(get("debit")) ?? 0;
      const credit = parseAmount(get("credit")) ?? 0;
      amount = round4(Math.abs(credit) - Math.abs(debit));
    }
    // Keep zero-amount rows (fee waivers, reversals) — they are staged as
    // 'ignored' so nothing silently disappears; only unparseable rows are skipped.
    if (amount == null) continue;
    txns.push({
      date,
      valueDate: normalizeDate(get("valueDate"), locale),
      amount,
      currency: (get("currency") || defaultCurrency).toUpperCase().slice(0, 3),
      description: get("description") || get("counterparty") || "",
      counterparty: get("counterparty") || undefined,
      externalRef: get("externalRef") || undefined,
      runningBalance: parseAmount(get("balance")) ?? undefined,
    });
  }
  return { txns };
}

// --- OFX (SGML) --------------------------------------------------------------

/** Parse an OFX statement: one NormalizedBankTxn per <STMTTRN> block. */
export function parseOfx(text: string, defaultCurrency = "USD"): ParsedStatement {
  const currency =
    firstTag(text, "CURDEF") || firstTag(text, "CURSYM") || defaultCurrency;
  const txns: NormalizedBankTxn[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi) || [];
  for (const block of blocks) {
    const amount = parseAmount(firstTag(block, "TRNAMT"));
    const date = normalizeDate(firstTag(block, "DTPOSTED"));
    if (amount == null || !date) continue;
    const name = firstTag(block, "NAME");
    const memo = firstTag(block, "MEMO");
    txns.push({
      date,
      valueDate: normalizeDate(firstTag(block, "DTUSER")),
      amount,
      currency: currency.toUpperCase().slice(0, 3),
      description: [name, memo].filter(Boolean).join(" — ") || "",
      counterparty: name || undefined,
      externalRef: firstTag(block, "FITID") || undefined,
    });
  }
  const closing = parseAmount(firstTag(text, "BALAMT"));
  return { txns, closingBalance: closing ?? undefined };
}

// --- QIF ---------------------------------------------------------------------

/** Parse a QIF statement: records separated by a lone `^`, fields keyed by D/T/P/M/N/L. */
export function parseQif(text: string, defaultCurrency = "USD", locale: DateLocale = "us"): ParsedStatement {
  const txns: NormalizedBankTxn[] = [];
  let cur: Partial<NormalizedBankTxn> & { _amount?: number | null } = {};
  const flush = () => {
    // Keep zero-amount records (staged as 'ignored'); skip only unparseable ones.
    if (cur.date && cur._amount != null) {
      txns.push({
        date: cur.date,
        amount: cur._amount,
        currency: defaultCurrency.toUpperCase().slice(0, 3),
        description: cur.description || cur.counterparty || "",
        counterparty: cur.counterparty,
        externalRef: cur.externalRef,
      });
    }
    cur = {};
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith("!")) continue; // header (!Type:Bank)
    if (line === "^") {
      flush();
      continue;
    }
    const code = line[0];
    const val = line.slice(1).trim();
    switch (code) {
      case "D":
        cur.date = normalizeDate(val, locale);
        break;
      case "T":
      case "U":
        cur._amount = parseAmount(val);
        break;
      case "P":
        cur.counterparty = val;
        if (!cur.description) cur.description = val;
        break;
      case "M":
        cur.description = val;
        break;
      case "N":
        cur.externalRef = val;
        break;
      default:
        break;
    }
  }
  flush();
  return { txns };
}

// --- CAMT.053 (ISO 20022 XML) ------------------------------------------------

/** Parse a CAMT.053 statement: one NormalizedBankTxn per <Ntry>; sign from CdtDbtInd. */
export function parseCamt(text: string, defaultCurrency = "USD"): ParsedStatement {
  const txns: NormalizedBankTxn[] = [];
  const entries = text.match(/<(?:\w+:)?Ntry>[\s\S]*?<\/(?:\w+:)?Ntry>/gi) || [];
  for (const entry of entries) {
    const amtMatch = entry.match(/<(?:\w+:)?Amt[^>]*>\s*([^<]+)/i);
    const rawAmt = amtMatch ? parseAmount(amtMatch[1]) : null;
    const ccyMatch = entry.match(/<(?:\w+:)?Amt[^>]*\bCcy="([^"]+)"/i);
    const ind = firstTag(entry, "CdtDbtInd");
    const bookg = entry.match(/<(?:\w+:)?BookgDt>[\s\S]*?<(?:\w+:)?Dt(?:Tm)?>\s*([^<]+)/i);
    const val = entry.match(/<(?:\w+:)?ValDt>[\s\S]*?<(?:\w+:)?Dt(?:Tm)?>\s*([^<]+)/i);
    const date = normalizeDate(bookg ? bookg[1] : undefined);
    if (rawAmt == null || !date) continue;
    const signed = ind && /DBIT/i.test(ind) ? -Math.abs(rawAmt) : Math.abs(rawAmt);
    const info =
      firstTag(entry, "Ustrd") ||
      firstTag(entry, "AddtlNtryInf") ||
      firstTag(entry, "AddtlTxInf");
    txns.push({
      date,
      valueDate: normalizeDate(val ? val[1] : undefined),
      amount: round4(signed),
      currency: (ccyMatch ? ccyMatch[1] : defaultCurrency).toUpperCase().slice(0, 3),
      description: info || "",
      externalRef:
        firstTag(entry, "AcctSvcrRef") || firstTag(entry, "EndToEndId") || undefined,
    });
  }
  return { txns };
}

/** Dispatch to the right parser for a statement format. */
export function parseStatement(
  format: ImportFormat,
  text: string,
  defaultCurrency = "USD",
  locale: DateLocale = "us",
): ParsedStatement {
  switch (format) {
    case "csv":
      return parseCsv(text, defaultCurrency, locale);
    case "ofx":
      // OFX uses compact YYYYMMDD dates — locale is irrelevant.
      return parseOfx(text, defaultCurrency);
    case "qif":
      return parseQif(text, defaultCurrency, locale);
    case "camt":
      // CAMT.053 uses ISO dates — locale is irrelevant.
      return parseCamt(text, defaultCurrency);
  }
}

// --- Dedup -------------------------------------------------------------------

/**
 * A stable identity hash for a staged txn, so re-importing an overlapping file
 * never double-counts a line. Uses the bank's own reference when present;
 * otherwise the (date, amount, description) triple. Scoped to the bank account.
 */
export function dedupHash(bankAccountId: string, txn: NormalizedBankTxn): string {
  const key = txn.externalRef
    ? `ref:${txn.externalRef}`
    : `dad:${txn.date}:${round4(txn.amount)}:${(txn.description || "").toLowerCase().replace(/\s+/g, " ").trim()}`;
  return createHash("sha256").update(`${bankAccountId}|${key}`).digest("hex");
}

// --- Auto-categorization -----------------------------------------------------

export interface TxnRule {
  id: string;
  priority: number;
  matchType: "contains" | "exact" | "regex";
  matchField: "description" | "counterparty";
  pattern: string;
  amountMin?: number | null;
  amountMax?: number | null;
  targetAccountId: string;
  counterparty?: string | null;
  isActive?: boolean;
}

export interface Categorization {
  ruleId: string;
  accountId: string;
  counterparty?: string;
}

/** The highest-priority active rule that matches a txn, or null. Pure. */
export function categorize(txn: NormalizedBankTxn, rules: TxnRule[]): Categorization | null {
  const candidates = rules
    .filter((r) => r.isActive !== false)
    .sort((a, b) => a.priority - b.priority);
  for (const rule of candidates) {
    if (rule.amountMin != null && txn.amount < rule.amountMin) continue;
    if (rule.amountMax != null && txn.amount > rule.amountMax) continue;
    const hay = (rule.matchField === "counterparty" ? txn.counterparty : txn.description) || "";
    if (!matchesPattern(hay, rule)) continue;
    return {
      ruleId: rule.id,
      accountId: rule.targetAccountId,
      counterparty: rule.counterparty ?? undefined,
    };
  }
  return null;
}

function matchesPattern(hay: string, rule: TxnRule): boolean {
  const h = hay.toLowerCase();
  const p = rule.pattern.toLowerCase();
  switch (rule.matchType) {
    case "exact":
      return h === p;
    case "regex":
      try {
        return new RegExp(rule.pattern, "i").test(hay);
      } catch {
        return false; // an invalid stored regex never matches (and never throws)
      }
    case "contains":
    default:
      return h.includes(p);
  }
}

// --- Reconciliation ----------------------------------------------------------

// A posted journal entry as a reconciliation candidate: the signed amount its
// line takes on the bank's cash GL account, and its entry date.
export interface EntryCandidate {
  entryId: string;
  entryDate: string;
  bankLineAmount: Money;
}

export interface ReconMatch {
  entryId: string;
  dayDelta: number;
}

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * Reconciliation candidates for a staged txn: posted entries whose bank-account
 * line equals the txn amount (to the cent) within ±windowDays, closest date
 * first. The reconciliation bot auto-matches only when there is exactly one.
 */
export function reconciliationCandidates(
  txn: NormalizedBankTxn,
  entries: EntryCandidate[],
  windowDays = 3,
): ReconMatch[] {
  const target = round4(txn.amount);
  return entries
    .filter((e) => round4(e.bankLineAmount) === target)
    .map((e) => ({ entryId: e.entryId, dayDelta: Math.abs(daysBetween(txn.date, e.entryDate)) }))
    .filter((m) => m.dayDelta <= windowDays)
    .sort((a, b) => a.dayDelta - b.dayDelta);
}

/** The single unambiguous auto-match for a txn, or null. */
export function autoMatch(
  txn: NormalizedBankTxn,
  entries: EntryCandidate[],
  windowDays = 3,
): string | null {
  const matches = reconciliationCandidates(txn, entries, windowDays);
  if (matches.length === 1) return matches[0].entryId;
  // A single closest match strictly nearer than the runner-up is also safe.
  if (matches.length > 1 && matches[0].dayDelta < matches[1].dayDelta) return matches[0].entryId;
  return null;
}
