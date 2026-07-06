import {
  isIssuanceEnvelope,
  mapEnvelopeStatus,
  mapRecordStatus,
  parseOfferingAmount,
  parseDealId,
  deriveLedgerRow,
  deriveLedger,
  formatUsd,
  type RawIssuanceEnvelope,
} from "./issuance-view";

const AGREEMENT = `SUBSCRIPTION AGREEMENT

Security Name: Series A Preferred Units
Offering Amount: $5,000,000 USD
Deal ID: deal-abc-123
Organization ID: org-1
Requested By: issuance-ui
Date: 2026-07-06T00:00:00.000Z
`;

describe("isIssuanceEnvelope", () => {
  it("recognizes subscription-agreement documents", () => {
    expect(isIssuanceEnvelope(AGREEMENT)).toBe(true);
    expect(isIssuanceEnvelope("  SUBSCRIPTION AGREEMENT\n...")).toBe(true);
  });
  it("rejects plain signing documents and empties", () => {
    expect(isIssuanceEnvelope("NDA between parties")).toBe(false);
    expect(isIssuanceEnvelope("")).toBe(false);
    expect(isIssuanceEnvelope(null)).toBe(false);
    expect(isIssuanceEnvelope(undefined)).toBe(false);
  });
});

describe("mapEnvelopeStatus", () => {
  it("maps envelope statuses to ledger statuses", () => {
    expect(mapEnvelopeStatus("draft")).toBe("draft");
    expect(mapEnvelopeStatus("sent")).toBe("pending");
    expect(mapEnvelopeStatus("partially_signed")).toBe("pending");
    expect(mapEnvelopeStatus("completed")).toBe("issued");
    expect(mapEnvelopeStatus("voided")).toBe("cancelled");
    expect(mapEnvelopeStatus("declined")).toBe("cancelled");
  });
  it("defaults unknown/empty to draft", () => {
    expect(mapEnvelopeStatus(null)).toBe("draft");
    expect(mapEnvelopeStatus(undefined)).toBe("draft");
    expect(mapEnvelopeStatus("whatever")).toBe("draft");
  });
});

describe("mapRecordStatus", () => {
  it("maps provider record statuses", () => {
    expect(mapRecordStatus("issued")).toBe("issued");
    expect(mapRecordStatus("cancelled")).toBe("cancelled");
    expect(mapRecordStatus("draft")).toBe("draft");
    expect(mapRecordStatus(null)).toBe("draft");
    expect(mapRecordStatus(undefined)).toBe("draft");
  });
});

describe("parseOfferingAmount", () => {
  it("parses a comma-grouped dollar amount", () => {
    expect(parseOfferingAmount(AGREEMENT)).toBe(5_000_000);
  });
  it("parses decimals", () => {
    expect(parseOfferingAmount("Offering Amount: $1,250.50 USD")).toBe(1250.5);
  });
  it("returns null when absent", () => {
    expect(parseOfferingAmount("no amount here")).toBeNull();
    expect(parseOfferingAmount(null)).toBeNull();
  });
});

describe("parseDealId", () => {
  it("parses the deal id line", () => {
    expect(parseDealId(AGREEMENT)).toBe("deal-abc-123");
  });
  it("returns null when absent", () => {
    expect(parseDealId("nothing")).toBeNull();
    expect(parseDealId(undefined)).toBeNull();
  });
});

describe("deriveLedgerRow", () => {
  it("maps a completed envelope with issuedAt", () => {
    const env: RawIssuanceEnvelope = {
      id: "env-1",
      title: "Series A Preferred Units",
      status: "completed",
      document_content: AGREEMENT,
      created_at: "2026-07-06T00:00:00.000Z",
      completed_at: "2026-07-06T10:00:00.000Z",
    };
    expect(deriveLedgerRow(env)).toEqual({
      securityId: "env-1",
      securityName: "Series A Preferred Units",
      status: "issued",
      dealId: "deal-abc-123",
      offeringAmountUsd: 5_000_000,
      createdAt: "2026-07-06T00:00:00.000Z",
      issuedAt: "2026-07-06T10:00:00.000Z",
    });
  });
  it("does not surface completed_at as issuedAt for a draft", () => {
    const row = deriveLedgerRow({
      id: "env-2",
      title: "Note",
      status: "draft",
      document_content: AGREEMENT,
      created_at: null,
      completed_at: "2026-07-06T10:00:00.000Z",
    });
    expect(row.status).toBe("draft");
    expect(row.issuedAt).toBeNull();
  });
});

describe("deriveLedger", () => {
  it("keeps only issuance envelopes", () => {
    const rows = deriveLedger([
      {
        id: "a",
        title: "Series A",
        status: "draft",
        document_content: AGREEMENT,
        created_at: null,
        completed_at: null,
      },
      {
        id: "b",
        title: "Random NDA",
        status: "sent",
        document_content: "NDA body",
        created_at: null,
        completed_at: null,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].securityId).toBe("a");
  });
});

describe("formatUsd", () => {
  it("formats whole dollars without cents", () => {
    expect(formatUsd(5_000_000)).toBe("$5,000,000");
  });
  it("handles null/invalid", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(undefined)).toBe("—");
    expect(formatUsd(Number.NaN)).toBe("—");
  });
});
