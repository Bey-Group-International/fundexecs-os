// Tests for the legal-dd core. The scenario is worked by hand:
//   Globex MSA: change of control = termination right, exclusivity = yes, doc + clause cited  -> 2 derived amber issues, grade A
//   Initech reseller: change of control unknown, doc cited but no clause                      -> 1 derived amber, grade U, uncited
//   Licence: change of control none, exclusivity no, every field stated                       -> no issue
//   IP: brand mark has a registration (fine); core algorithm has no title evidence            -> 1 derived amber, grade U
//   Supplied: a claim (red, cited, merged with a duplicate), board minutes (green, no clause), CTO contract (amber, no document)
import { legalDd, type LegalDdInput } from "./legal-dd";
import { validate } from "@/lib/skills/validate";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = {
  workspaceId: "org1",
  principalId: "p1",
  executive: "diligence",
};

const input: LegalDdInput = {
  dealName: "Acme",
  documentsReceived: [
    "Material contracts folder",
    "Corporate records",
    "Litigation file",
  ],
  categoriesReviewed: ["contract", "litigation"],
  contracts: [
    {
      name: "Master supply agreement",
      counterparty: "Globex",
      term: "5 years from 2023",
      changeOfControl: "termination-right",
      exclusivity: "yes",
      assignment: "Consent needed",
      terminationRights: "90 days' notice",
      liabilityCap: "12 months' fees",
      documentRef: "DR-1/MSA.pdf",
      clauseRef: "cl. 14.2",
    },
    {
      name: "Reseller agreement",
      counterparty: "Initech",
      documentRef: "DR-1/RA.pdf",
    },
    {
      name: "Software licence",
      counterparty: "Hooli",
      term: "Perpetual",
      changeOfControl: "none",
      exclusivity: "no",
      assignment: "Free",
      terminationRights: "Breach only",
      liabilityCap: "Uncapped",
      documentRef: "DR-1/SL.pdf",
      clauseRef: "cl. 9",
    },
  ],
  ipAssets: [
    {
      name: "Brand mark",
      titleEvidence: "registration",
      documentRef: "DR-4/TM.pdf",
    },
    { name: "Core algorithm", titleEvidence: "none" },
  ],
  issues: [
    {
      title: "Pending claim by former distributor",
      rating: "red",
      category: "litigation",
      documentRef: "DR-3/claim.pdf",
      clauseRef: "para 4",
      evidenceGrade: "A",
      impact: "price",
      rangeLow: 0.5,
      rangeHigh: 1.2,
      rangeBasis: "Damages sought in the claim letter, para 4",
      question: "Prospects and likely settlement range?",
    },
    {
      title: "Pending claim by former distributor",
      rating: "amber",
      category: "litigation",
      documentRef: "DR-3/letter.pdf",
      clauseRef: "p2",
      evidenceGrade: "A",
    },
    {
      title: "Board minutes missing for 2022",
      rating: "green",
      category: "corporate",
      documentRef: "DR-2/minutes",
    },
    {
      title: "Unsigned employment contract for the CTO",
      rating: "amber",
      category: "employment",
    },
  ],
};
const run = (i: LegalDdInput) => legalDd.run(i, ctx);

describe("legal-dd core", () => {
  it("abstracts each contract and names the fields that are not stated, without guessing", () => {
    const r = run(input).structured;
    expect(r.abstract.map((a) => a.name)).toEqual([
      "Master supply agreement",
      "Reseller agreement",
      "Software licence",
    ]);
    expect(r.abstract[0].notStated).toEqual([]);
    expect(r.abstract[1]).toMatchObject({
      changeOfControl: "unknown",
      exclusivity: "unknown",
      term: null,
      liabilityCap: null,
    });
    expect(r.abstract[1].notStated).toEqual([
      "term",
      "change of control",
      "exclusivity",
      "assignment",
      "termination rights",
      "liability cap",
    ]);
    expect(r.abstract[2].notStated).toEqual([]);
  });

  it("derives change-of-control, exclusivity and IP-title issues by rule, and nothing for a clean contract", () => {
    const r = run(input).structured;
    const titles = r.issues.map((i) => i.title);
    expect(titles).toContain(
      "Change of control: Master supply agreement (Globex) — counterparty may terminate",
    );
    expect(titles).toContain("Exclusivity: Master supply agreement (Globex)");
    expect(titles).toContain(
      "Change of control unconfirmed: Reseller agreement (Initech)",
    );
    expect(titles).toContain("IP title unconfirmed: Core algorithm");
    expect(titles.some((t) => /Software licence|Brand mark/.test(t))).toBe(
      false,
    );
    expect(r.derivedCount).toBe(4);
    const coc = r.issues.find((i) =>
      i.title.startsWith("Change of control: Master"),
    )!;
    expect(coc).toMatchObject({
      rating: "amber",
      evidenceGrade: "A",
      cited: true,
      derived: true,
      documentRef: "DR-1/MSA.pdf",
      clauseRef: "cl. 14.2",
    });
  });

  it("ranks red first, then amber by evidence, then green; merges the duplicate claim to the worst rating", () => {
    const r = run(input).structured;
    expect(r.issues).toHaveLength(7);
    expect(r.duplicatesMerged).toBe(1);
    expect(r.counts).toEqual({ red: 1, amber: 5, green: 1 });
    expect(r.issues[0]).toMatchObject({
      title: "Pending claim by former distributor",
      rating: "red",
      documentRef: "DR-3/claim.pdf; DR-3/letter.pdf",
    });
    expect(r.issues[0].range).toEqual({
      low: 0.5,
      high: 1.2,
      basis: "Damages sought in the claim letter, para 4",
    });
    expect(r.issues.slice(1, 3).map((i) => i.evidenceGrade)).toEqual([
      "A",
      "A",
    ]);
    expect(r.issues[6]).toMatchObject({
      rating: "green",
      title: "Board minutes missing for 2022",
    });
  });

  it("an issue that cites no document, or no clause, is kept, graded U and listed", () => {
    const r = run(input);
    expect(r.structured.uncited.sort()).toEqual([
      "Board minutes missing for 2022",
      "Change of control unconfirmed: Reseller agreement (Initech)",
      "IP title unconfirmed: Core algorithm",
      "Unsigned employment contract for the CTO",
    ]);
    const cto = r.structured.issues.find((i) =>
      i.title.startsWith("Unsigned"),
    )!;
    expect(cto).toMatchObject({ cited: false, evidenceGrade: "U" });
    expect(r.missingData.join(" ")).toMatch(
      /4 issues cite no document and clause/,
    );
  });

  it("lists missing documents and categories not reviewed as gaps", () => {
    const r = run(input);
    expect(r.structured.documentGaps).toEqual([
      "ip register",
      "employment contracts",
    ]);
    expect(r.structured.notReviewed).toEqual([
      "regulatory",
      "ip",
      "corporate",
      "employment",
    ]);
    expect(r.missingData.join(" ")).toMatch(
      /Documents not received: ip register, employment contracts/,
    );
    const none = run({});
    expect(none.structured.documentGaps).toHaveLength(5);
    expect(none.structured.notReviewed).toHaveLength(6);
    expect(none.missingData.join(" ")).toMatch(
      /data room contains was not supplied/,
    );
    expect(none.missingData.join(" ")).toMatch(/No review coverage stated/);
    expect(none.structured.note).toMatch(/not a clean bill/);
  });

  it("hands red and amber issues with an impact to the red flag register and counts the rest", () => {
    const h = run(input).structured.handoff;
    expect(h.findings).toEqual([
      {
        title: "Pending claim by former distributor",
        workstream: "legal",
        severity: "red",
        impact: "price",
        evidenceGrade: "A",
        sourceRef: "DR-3/claim.pdf; DR-3/letter.pdf, para 4; p2",
      },
    ]);
    expect(h.needingImpact).toHaveLength(5);
  });

  it("is deterministic, validates against its schemas, states the limitation and names counsel as the gate", () => {
    const a = run(input);
    expect(JSON.stringify(run(input).structured)).toBe(
      JSON.stringify(a.structured),
    );
    expect(validate(a.structured, legalDd.manifest.outputSchema).valid).toBe(
      true,
    );
    expect(validate(input, legalDd.manifest.inputSchema).valid).toBe(true);
    expect(validate({}, legalDd.manifest.inputSchema).valid).toBe(true);
    expect(a.structured.limitation).toMatch(/not legal advice/);
    expect(a.structured.gate).toBe(
      "Deal counsel reviews and owns the legal findings.",
    );
    expect(run({ ...input, gateOwner: "Jane Doe, GC" }).structured.gate).toBe(
      "Jane Doe, GC reviews and owns the legal findings.",
    );
  });

  it("reads correctly when exactly one issue is uncited", () => {
    expect(
      run({
        issues: [{ title: "Side letter", rating: "amber" }],
      }).missingData.join(" "),
    ).toMatch(/1 issue cites no document and clause: Side letter/);
  });
});
