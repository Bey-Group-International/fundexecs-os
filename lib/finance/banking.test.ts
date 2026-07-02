import {
  detectFormat,
  parseAmount,
  normalizeDate,
  splitCsvLine,
  parseCsv,
  parseOfx,
  parseQif,
  parseCamt,
  parseStatement,
  dedupHash,
  categorize,
  reconciliationCandidates,
  autoMatch,
  type NormalizedBankTxn,
  type TxnRule,
  type EntryCandidate,
} from "./banking";

describe("parseAmount", () => {
  it("parses plain, signed, and grouped numbers", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("-12.30")).toBe(-12.3);
    expect(parseAmount("+50")).toBe(50);
    expect(parseAmount("$1,000.00")).toBe(1000);
  });
  it("treats accounting parentheses as negative", () => {
    expect(parseAmount("(75.00)")).toBe(-75);
  });
  it("handles European grouping (1.234,56)", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1234,5")).toBe(1234.5);
  });
  it("returns null for empty/garbage", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("n/a")).toBeNull();
  });
});

describe("normalizeDate", () => {
  it("normalizes compact, ISO and slashed dates", () => {
    expect(normalizeDate("20260215")).toBe("2026-02-15");
    expect(normalizeDate("20260215120000")).toBe("2026-02-15");
    expect(normalizeDate("2026-02-15")).toBe("2026-02-15");
    expect(normalizeDate("2026-02-15T10:30:00")).toBe("2026-02-15");
  });
  it("resolves M/D when day > 12 disambiguates", () => {
    expect(normalizeDate("2/15/2026")).toBe("2026-02-15");
  });
  it("expands 2-digit years", () => {
    expect(normalizeDate("15/02/26")).toBe("2026-02-15");
  });
});

describe("splitCsvLine", () => {
  it("honors quoted fields with commas", () => {
    expect(splitCsvLine('2026-01-01,"ACME, Inc.",100.00')).toEqual([
      "2026-01-01",
      "ACME, Inc.",
      "100.00",
    ]);
  });
  it("handles escaped double quotes", () => {
    expect(splitCsvLine('"a ""b"" c",2')).toEqual(['a "b" c', "2"]);
  });
});

describe("detectFormat", () => {
  it("detects each format", () => {
    expect(detectFormat("OFXHEADER:100\n<OFX><BANKMSGSRSV1>")).toBe("ofx");
    expect(detectFormat("!Type:Bank\nD2026-01-01\nT100\n^")).toBe("qif");
    expect(detectFormat('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:camt.053.001.02"><Ntry>')).toBe("camt");
    expect(detectFormat("Date,Description,Amount\n2026-01-01,Coffee,-4.50")).toBe("csv");
  });
  it("returns null for unrecognized content", () => {
    expect(detectFormat("just some prose without delimiters")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("parses a single-amount CSV with a balance column", () => {
    const csv = [
      "Date,Description,Amount,Balance",
      "2026-01-02,Coffee Shop,-4.50,995.50",
      "2026-01-03,Payroll Deposit,2000.00,2995.50",
    ].join("\n");
    const { txns } = parseCsv(csv);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-01-02", amount: -4.5, runningBalance: 995.5 });
    expect(txns[1]).toMatchObject({ date: "2026-01-03", amount: 2000 });
  });
  it("derives signed amount from Debit/Credit columns", () => {
    const csv = [
      "Date,Details,Debit,Credit",
      "2026-01-02,Rent,1500.00,",
      "2026-01-03,Refund,,49.99",
    ].join("\n");
    const { txns } = parseCsv(csv);
    expect(txns[0].amount).toBe(-1500);
    expect(txns[1].amount).toBe(49.99);
  });
  it("skips rows without a parseable date (totals/blanks)", () => {
    const csv = ["Date,Description,Amount", "TOTAL,,100", "2026-01-02,Coffee,-4.50"].join("\n");
    const { txns } = parseCsv(csv);
    expect(txns).toHaveLength(1);
  });
});

describe("parseOfx", () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD</CURDEF><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260102<TRNAMT>-4.50<FITID>A1<NAME>Coffee Shop<MEMO>card</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260103<TRNAMT>2000.00<FITID>A2<NAME>Payroll</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>2995.50<DTASOF>20260103</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  it("parses transactions with signed amounts and FITIDs", () => {
    const { txns, closingBalance } = parseOfx(ofx);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-01-02", amount: -4.5, externalRef: "A1", currency: "USD" });
    expect(txns[0].description).toContain("Coffee Shop");
    expect(txns[1]).toMatchObject({ date: "2026-01-03", amount: 2000, externalRef: "A2" });
    expect(closingBalance).toBe(2995.5);
  });
});

describe("parseQif", () => {
  it("parses records separated by ^", () => {
    const qif = ["!Type:Bank", "D01/02/2026", "T-4.50", "PCoffee Shop", "^", "D01/03/2026", "T2000.00", "PPayroll", "MDirect deposit", "^"].join("\n");
    const { txns } = parseQif(qif);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-01-02", amount: -4.5, counterparty: "Coffee Shop" });
    expect(txns[1]).toMatchObject({ date: "2026-01-03", amount: 2000, description: "Direct deposit" });
  });
});

describe("parseCamt", () => {
  const camt = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Ntry><Amt Ccy="EUR">4.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-01-02</Dt></BookgDt><NtryDtls><TxDtls><RmtInf><Ustrd>Coffee Shop</Ustrd></RmtInf><Refs><AcctSvcrRef>R1</AcctSvcrRef></Refs></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">2000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-01-03</Dt></BookgDt><NtryDtls><TxDtls><RmtInf><Ustrd>Payroll</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
  it("signs amounts by CdtDbtInd and reads the entry currency", () => {
    const { txns } = parseCamt(camt);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-01-02", amount: -4.5, currency: "EUR", description: "Coffee Shop", externalRef: "R1" });
    expect(txns[1]).toMatchObject({ date: "2026-01-03", amount: 2000, currency: "EUR", description: "Payroll" });
  });
  it("is reachable via parseStatement dispatch", () => {
    expect(parseStatement("camt", camt).txns).toHaveLength(2);
  });
});

describe("dedupHash", () => {
  const base: NormalizedBankTxn = { date: "2026-01-02", amount: -4.5, currency: "USD", description: "Coffee Shop" };
  it("is stable for the same txn + account", () => {
    expect(dedupHash("acct-1", base)).toBe(dedupHash("acct-1", base));
  });
  it("differs across bank accounts", () => {
    expect(dedupHash("acct-1", base)).not.toBe(dedupHash("acct-2", base));
  });
  it("prefers the external reference when present", () => {
    const a = dedupHash("acct-1", { ...base, externalRef: "FIT-1" });
    const b = dedupHash("acct-1", { ...base, externalRef: "FIT-1", description: "different text" });
    expect(a).toBe(b); // same FITID → same identity regardless of description
  });
  it("falls back to date+amount+description without a reference", () => {
    const a = dedupHash("acct-1", base);
    const b = dedupHash("acct-1", { ...base, amount: -5.0 });
    expect(a).not.toBe(b);
  });
});

describe("categorize", () => {
  const rules: TxnRule[] = [
    { id: "r-coffee", priority: 10, matchType: "contains", matchField: "description", pattern: "coffee", targetAccountId: "acc-meals" },
    { id: "r-rent", priority: 5, matchType: "regex", matchField: "description", pattern: "^rent", targetAccountId: "acc-rent", amountMax: 0 },
    { id: "r-inactive", priority: 1, matchType: "contains", matchField: "description", pattern: "coffee", targetAccountId: "acc-x", isActive: false },
  ];
  it("returns the highest-priority active matching rule", () => {
    const txn: NormalizedBankTxn = { date: "2026-01-02", amount: -4.5, currency: "USD", description: "Coffee Shop" };
    expect(categorize(txn, rules)?.accountId).toBe("acc-meals");
  });
  it("respects amount bounds", () => {
    const income: NormalizedBankTxn = { date: "2026-01-02", amount: 100, currency: "USD", description: "Rent received" };
    // amountMax:0 excludes positive amounts, so the rent rule does not fire.
    expect(categorize(income, rules)).toBeNull();
    const outflow: NormalizedBankTxn = { date: "2026-01-02", amount: -1500, currency: "USD", description: "Rent payment" };
    expect(categorize(outflow, rules)?.accountId).toBe("acc-rent");
  });
  it("never throws on an invalid stored regex", () => {
    const bad: TxnRule[] = [{ id: "r", priority: 1, matchType: "regex", matchField: "description", pattern: "(", targetAccountId: "a" }];
    const txn: NormalizedBankTxn = { date: "2026-01-02", amount: -1, currency: "USD", description: "x" };
    expect(() => categorize(txn, bad)).not.toThrow();
    expect(categorize(txn, bad)).toBeNull();
  });
});

describe("reconciliation", () => {
  const txn: NormalizedBankTxn = { date: "2026-01-10", amount: -250, currency: "USD", description: "Vendor payment" };
  const entries: EntryCandidate[] = [
    { entryId: "e-exact", entryDate: "2026-01-10", bankLineAmount: -250 },
    { entryId: "e-near", entryDate: "2026-01-12", bankLineAmount: -250 },
    { entryId: "e-wrong-amt", entryDate: "2026-01-10", bankLineAmount: -251 },
    { entryId: "e-far", entryDate: "2026-02-01", bankLineAmount: -250 },
  ];
  it("finds amount-equal candidates within the date window, closest first", () => {
    const matches = reconciliationCandidates(txn, entries, 3);
    expect(matches.map((m) => m.entryId)).toEqual(["e-exact", "e-near"]);
  });
  it("auto-matches the single closest candidate", () => {
    expect(autoMatch(txn, entries, 3)).toBe("e-exact");
  });
  it("refuses to auto-match when two candidates are equally close", () => {
    const ambiguous: EntryCandidate[] = [
      { entryId: "a", entryDate: "2026-01-08", bankLineAmount: -250 },
      { entryId: "b", entryDate: "2026-01-12", bankLineAmount: -250 },
    ];
    expect(autoMatch(txn, ambiguous, 3)).toBeNull();
  });
  it("returns nothing when no amount matches", () => {
    expect(reconciliationCandidates({ ...txn, amount: -999 }, entries, 3)).toEqual([]);
  });
});
