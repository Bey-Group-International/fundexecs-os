import { cleanBlocks, recipientsWithoutSignature, templateSignatureProblem, MAX_BLOCKS } from "./envelope-fields";

const ok = { recipientId: "r1", type: "signature", page: 1, xPct: 10, yPct: 10, widthPct: 20, heightPct: 6 };

describe("cleanBlocks", () => {
  it("accepts a valid block and keeps it on the page", () => {
    const r = cleanBlocks([{ ...ok, xPct: 95 }], ["r1"], 2);
    expect(r.ok && r.blocks[0]).toMatchObject({ recipient_id: "r1", field_type: "signature", page: 1, x_pct: 80, label: "Signature", required: true, locked: false });
  });

  it("rejects an unknown type, a stranger as the signer, and a page that does not exist", () => {
    expect(cleanBlocks([{ ...ok, type: "nope" }], ["r1"], 1)).toMatchObject({ ok: false });
    expect(cleanBlocks([{ ...ok, recipientId: "x" }], ["r1"], 1)).toMatchObject({ ok: false });
    expect(cleanBlocks([{ ...ok, page: 3 }], ["r1"], 2)).toMatchObject({ ok: false });
    expect(cleanBlocks([{ ...ok, page: 0 }], ["r1"], 2)).toMatchObject({ ok: false });
    expect(cleanBlocks("nope", ["r1"], 1)).toMatchObject({ ok: false });
  });

  it("caps the number of blocks", () => {
    expect(cleanBlocks(Array(MAX_BLOCKS + 1).fill(ok), ["r1"], 1)).toMatchObject({ ok: false });
  });

  it("only locks a block that has a value to lock, and trims the value", () => {
    const r = cleanBlocks([{ ...ok, type: "company", prefill: "  Acme LP  ", locked: true }, { ...ok, type: "title", locked: true }], ["r1"], 1);
    expect(r.ok && r.blocks.map((b) => [b.prefill, b.locked])).toEqual([["Acme LP", true], [null, false]]);
  });
});

describe("recipientsWithoutSignature", () => {
  it("names everyone who has no signature block, so nobody can be sent a document they cannot sign", () => {
    const people = [{ id: "a", name: "Jane" }, { id: "b", name: "You" }];
    expect(recipientsWithoutSignature(people, [{ recipient_id: "a", field_type: "signature" }, { recipient_id: "b", field_type: "name" }])).toEqual(["You"]);
    expect(recipientsWithoutSignature(people, [])).toEqual(["Jane", "You"]);
    expect(recipientsWithoutSignature(people, [{ recipient_id: "a", field_type: "signature" }, { recipient_id: "b", field_type: "signature" }])).toEqual([]);
  });

  it("only a required signature block counts, so a document cannot be finished without signing", () => {
    const people = [{ id: "a", name: "Jane" }, { id: "b", name: "You" }];
    const opt = (id: string) => ({ recipient_id: id, field_type: "signature", required: false });
    const req = (id: string) => ({ recipient_id: id, field_type: "signature", required: true });
    expect(recipientsWithoutSignature(people, [opt("a"), req("b")])).toEqual(["Jane"]);
    expect(recipientsWithoutSignature(people, [opt("a"), req("a"), req("b")])).toEqual([]);
    // An older block with no flag is required.
    expect(recipientsWithoutSignature(people, [{ recipient_id: "a", field_type: "signature" }, req("b")])).toEqual([]);
  });
});

describe("an Other block", () => {
  const base = { recipientId: "a", type: "other", page: 1, xPct: 10, yPct: 10, widthPct: 28, heightPct: 4 };
  it("keeps the sender's name for it, trimmed and limited, and falls back to Other", () => {
    const r = cleanBlocks([{ ...base, label: "  Tax ID  " }, { ...base, label: "" }, { ...base, label: "x".repeat(200) }, { ...base }], ["a"], 1);
    expect(r.ok && r.blocks.map((b) => b.label)).toEqual(["Tax ID", "Other", "x".repeat(60), "Other"]);
  });
  it("ignores a name sent for any other type", () => {
    const r = cleanBlocks([{ ...base, type: "company", label: "Sneaky" }], ["a"], 1);
    expect(r.ok && r.blocks[0].label).toBe("Company");
  });
});

describe("initials blocks", () => {
  const ok = { recipientId: "r1", type: "initials", page: 1, xPct: 10, yPct: 10, widthPct: 28, heightPct: 4 };
  it("are accepted as a block of their own", () => {
    const r = cleanBlocks([ok], ["r1"], 1);
    expect(r.ok && r.blocks[0]).toMatchObject({ field_type: "initials", label: "Initials", required: true });
  });
  it("do not stand in for a signature when checking a document can be signed", () => {
    const people = [{ id: "a", name: "Jane" }];
    expect(recipientsWithoutSignature(people, [{ recipient_id: "a", field_type: "initials", required: true }])).toEqual(["Jane"]);
  });
});

describe("templateSignatureProblem (a data-room file's blocks)", () => {
  const sig = (who: string, required: boolean | undefined) => ({ recipient_id: who, field_type: "signature", required });
  it("is fine with no blocks, or a required signature each for the reader and the owner", () => {
    expect(templateSignatureProblem([])).toBeNull();
    expect(templateSignatureProblem([sig("signer", true), sig("owner", true)])).toBeNull();
    expect(templateSignatureProblem([sig("signer", undefined), sig("owner", true)])).toBeNull();
  });
  it("refuses a file where someone has no signature block, or only optional ones", () => {
    const msg = /required signature block for the reader and one for yourself/;
    expect(templateSignatureProblem([sig("signer", true)])).toMatch(msg);
    expect(templateSignatureProblem([sig("signer", false), sig("owner", true)])).toMatch(msg);
    expect(templateSignatureProblem([sig("signer", true), sig("owner", false)])).toMatch(msg);
    expect(templateSignatureProblem([{ recipient_id: "owner", field_type: "initials", required: true }, sig("signer", true)])).toMatch(msg);
  });
});
