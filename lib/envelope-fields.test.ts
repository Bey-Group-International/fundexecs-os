import { cleanBlocks, recipientsWithoutSignature, MAX_BLOCKS } from "./envelope-fields";

const ok = { recipientId: "r1", type: "signature", page: 1, xPct: 10, yPct: 10, widthPct: 20, heightPct: 6 };

describe("cleanBlocks", () => {
  it("accepts a valid block and keeps it on the page", () => {
    const r = cleanBlocks([{ ...ok, xPct: 95 }], ["r1"], 2);
    expect(r.ok && r.blocks[0]).toMatchObject({ recipient_id: "r1", field_type: "signature", page: 1, x_pct: 80, label: "Signature", required: true, locked: false });
  });

  it("rejects an unknown type, a stranger as the signer, and a page that does not exist", () => {
    expect(cleanBlocks([{ ...ok, type: "initials" }], ["r1"], 1)).toMatchObject({ ok: false });
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
});
