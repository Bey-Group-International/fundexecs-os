jest.mock("server-only", () => ({}), { virtual: true });
import { PDFDocument } from "pdf-lib";
import { stampBlocks } from "./stamp.server";
import { buildDocumentPdf } from "./executed-pdf.server";
import { BLOCKS, MAX_BLOCK_HEIGHT_PCT, MAX_BLOCK_WIDTH_PCT, MIN_BLOCK_HEIGHT_PCT, MIN_BLOCK_WIDTH_PCT, blockLabel, copyToEveryPage, resizeBlock, initialsOf, isInkInput, defaultRequired, BLOCK_HEIGHT_PCT, BLOCK_WIDTH_PCT, resolveDateTimeResponse, toOffsetIso, blockSpec, clampBlock, newBlockAt, formatBlockDateTime } from "./blocks";
import { missingRequiredFields } from "../envelope-signing";
import { blockValueProblem } from "./blocks";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("blocks", () => {
  it("offers exactly these blocks, and old types behave like their nearest block", () => {
    expect(BLOCKS.map((b) => b.type)).toEqual(["name", "signature", "initials", "datetime", "company", "title", "address", "email", "phone", "other"]);
    expect(blockSpec("initials")?.type).toBe("initials");
    expect(blockSpec("text")?.type).toBe("title");
    expect(blockSpec("date")?.type).toBe("datetime");
    expect(blockSpec("nope")).toBeNull();
  });

  it("makes typed initials from a name, and knows which blocks are marked by hand", () => {
    expect(initialsOf("Jane Q. Smith")).toBe("JQS");
    expect(initialsOf("  jane   smith ")).toBe("JS");
    expect(initialsOf("Cher")).toBe("C");
    expect(initialsOf("A B C D E")).toBe("ABC");
    expect(initialsOf("")).toBe("");
    expect(isInkInput("signature") && isInkInput("initials")).toBe(true);
    expect(isInkInput("text") || isInkInput("auto")).toBe(false);
    expect(defaultRequired("initials")).toBe(true);
  });

  it("resizes from the bottom-right corner, held between the smallest and largest sizes and inside the page", () => {
    const b = { xPct: 10, yPct: 20, widthPct: 28, heightPct: 4 };
    // The top-left stays put; the corner moves.
    expect(resizeBlock(b, 10, 3)).toEqual({ xPct: 10, yPct: 20, widthPct: 38, heightPct: 7 });
    expect(resizeBlock(b, -10, -1)).toEqual({ xPct: 10, yPct: 20, widthPct: 18, heightPct: 3 });
    // Never smaller than something that can be clicked, nor bigger than most of a page.
    expect(resizeBlock(b, -100, -100)).toMatchObject({ widthPct: MIN_BLOCK_WIDTH_PCT, heightPct: MIN_BLOCK_HEIGHT_PCT });
    expect(resizeBlock({ ...b, xPct: 0, yPct: 0 }, 500, 500)).toMatchObject({ widthPct: MAX_BLOCK_WIDTH_PCT, heightPct: MAX_BLOCK_HEIGHT_PCT });
    // Never past the page edge.
    expect(resizeBlock({ ...b, xPct: 80 }, 50, 0).widthPct).toBe(20);
    expect(resizeBlock({ ...b, yPct: 95 }, 0, 50).heightPct).toBe(5);
    expect(resizeBlock(b, NaN, NaN)).toEqual(b);
  });

  it("holds a block sent by a browser to the largest size too", () => {
    expect(clampBlock({ xPct: 0, yPct: 0, widthPct: 400, heightPct: 400 })).toMatchObject({ widthPct: MAX_BLOCK_WIDTH_PCT, heightPct: MAX_BLOCK_HEIGHT_PCT });
  });

  it("copies a block to the same spot on every other page, and does it only once", () => {
    const first = { recipientId: "a", type: "initials", page: 2, xPct: 80, yPct: 90 };
    const copies = copyToEveryPage(first, 4, [first]);
    expect(copies.map((c) => [c.page, c.xPct, c.yPct])).toEqual([[1, 80, 90], [3, 80, 90], [4, 80, 90]]);
    // Run again with the copies in place: nothing new.
    expect(copyToEveryPage(first, 4, [first, ...copies])).toEqual([]);
    // Another person's block, another kind of block, or a different spot does not count as already there.
    const others = [{ ...first, page: 1, recipientId: "b" }, { ...first, page: 3, type: "name" }, { ...first, page: 4, yPct: 50 }];
    expect(copyToEveryPage(first, 4, [first, ...others]).map((c) => c.page)).toEqual([1, 3, 4]);
    // A one-page document has nowhere to copy to.
    expect(copyToEveryPage({ ...first, page: 1 }, 1, [{ ...first, page: 1 }])).toEqual([]);
  });

  it("names an Other block as the sender did, and the rest by their own name", () => {
    expect(blockLabel("other", "  Tax ID ")).toBe("Tax ID");
    expect(blockLabel("other", "")).toBe("Other");
    expect(blockLabel("other", "x".repeat(99))).toHaveLength(60);
    expect(blockLabel("company", "Sneaky")).toBe("Company");
  });

  it("keeps a block wholly on its page, whatever the browser sends", () => {
    const b = clampBlock({ xPct: 98, yPct: -5, widthPct: 30, heightPct: 4 });
    expect(b.xPct).toBe(70);
    expect(b.yPct).toBe(0);
    expect(clampBlock({ xPct: NaN, yPct: NaN, widthPct: NaN, heightPct: NaN }).widthPct).toBe(20);
  });

  it("centres a new block on the click", () => {
    const b = newBlockAt("signature", 50, 50);
    // Starts at the click, centred on it vertically: the × at its left-middle is on the click.
    expect(b.xPct).toBeCloseTo(50);
    expect(b.yPct + b.heightPct / 2).toBeCloseTo(50);
  });

  it("formats a date-and-time block in UTC", () => {
    expect(formatBlockDateTime("2026-11-02T14:03:09.000Z")).toBe("Nov 2, 2026, 14:03:09 UTC");
  });
});

describe("required blocks", () => {
  const f = (id: string, field_type: never, required = true) => ({ id, field_type, label: null, required });
  it("auto-fills date-and-time, needs the signature image, and needs text for the rest", () => {
    const fields = [f("a", "name" as never), f("b", "signature" as never), f("c", "datetime" as never), f("d", "address" as never)];
    expect(missingRequiredFields(fields, { signatureData: "", initialsData: null, fieldResponses: {} })).toEqual(["name", "signature", "address"]);
    expect(missingRequiredFields(fields, { signatureData: PNG, initialsData: null, fieldResponses: { a: "Jane", d: "1 Main St" } })).toEqual([]);
  });
});

describe("stampBlocks", () => {
  it("writes text and the drawn signature at the placed positions on the right page", async () => {
    const base = await buildDocumentPdf({ title: "Agreement", text: "# Agreement\n\n" + "Clause.\n".repeat(120) });
    const before = await PDFDocument.load(base);
    expect(before.getPageCount()).toBeGreaterThan(1);
    const out = await stampBlocks(base, [
      { page: 1, xPct: 10, yPct: 80, widthPct: 26, heightPct: 7, type: "signature", value: null, signaturePng: PNG },
      { page: 1, xPct: 10, yPct: 70, widthPct: 24, heightPct: 3.5, type: "name", value: "Jane Smith" },
      { page: 2, xPct: 50, yPct: 10, widthPct: 34, heightPct: 8, type: "address", value: "1 Main Street\nWilmington, DE 19801" },
      { page: 99, xPct: 0, yPct: 0, widthPct: 10, heightPct: 4, type: "name", value: "ignored: no such page" },
    ]);
    const after = await PDFDocument.load(out);
    expect(after.getPageCount()).toBe(before.getPageCount());
    expect(Buffer.from(out).includes(Buffer.from("/Subtype /Image"))).toBe(true);
    expect(out.length).toBeGreaterThan(base.length);
  });

  it("draws initials as an image at their spot, as it does a signature", async () => {
    const base = await buildDocumentPdf({ title: "A", text: "x" });
    const out = await stampBlocks(base, [{ page: 1, xPct: 10, yPct: 10, widthPct: 14, heightPct: 4, type: "initials", value: null, signaturePng: PNG }]);
    expect(Buffer.from(out).includes(Buffer.from("/Subtype /Image"))).toBe(true);
  });

  it("skips an empty value and a bad signature image without failing", async () => {
    const base = await buildDocumentPdf({ title: "A", text: "x" });
    const out = await stampBlocks(base, [
      { page: 1, xPct: 10, yPct: 10, widthPct: 20, heightPct: 4, type: "company", value: "  " },
      { page: 1, xPct: 10, yPct: 20, widthPct: 20, heightPct: 6, type: "signature", value: null, signaturePng: "data:image/png;base64,AAAA" },
    ]);
    expect(Buffer.from(out).includes(Buffer.from("/Subtype /Image"))).toBe(false);
  });
});

describe("blockValueProblem", () => {
  it("accepts good emails and phone numbers, and empty values", () => {
    expect(blockValueProblem("email", "jane@lp.com")).toBeNull();
    expect(blockValueProblem("phone", "+1 (415) 555-0100")).toBeNull();
    expect(blockValueProblem("email", "")).toBeNull();
    expect(blockValueProblem("name", "anything at all")).toBeNull();
  });
  it("refuses a malformed email or phone number", () => {
    expect(blockValueProblem("email", "jane@")).toMatch(/valid email/);
    expect(blockValueProblem("email", "no at sign.com")).toMatch(/valid email/);
    expect(blockValueProblem("phone", "12")).toMatch(/valid phone/);
    expect(blockValueProblem("phone", "call me")).toMatch(/valid phone/);
  });
});

describe("uniform block size", () => {
  it("gives every block type the same size when placed", () => {
    const sizes = new Set(BLOCKS.map((b) => `${newBlockAt(b.type, 50, 50).widthPct}x${newBlockAt(b.type, 50, 50).heightPct}`));
    expect(sizes.size).toBe(1);
    expect(BLOCKS.every((b) => b.widthPct === BLOCK_WIDTH_PCT && b.heightPct === BLOCK_HEIGHT_PCT)).toBe(true);
  });
});

describe("date and time blocks", () => {
  const NOW = "2026-11-04T22:03:09.000Z";
  it("keeps the signer's own clock when printing a chosen time, and UTC for a server stamp", () => {
    expect(formatBlockDateTime("2026-11-04T14:03:00-08:00")).toBe("Nov 4, 2026, 14:03 UTC-08:00");
    expect(formatBlockDateTime("2026-11-04T22:03:09.000Z")).toBe("Nov 4, 2026, 22:03:09 UTC");
  });
  it("writes a Date as wall clock plus offset", () => {
    const d = new Date(2026, 10, 4, 14, 3);
    expect(toOffsetIso(d)).toMatch(/^2026-11-04T14:03:00[+-]\d{2}:\d{2}$/);
    expect(Date.parse(toOffsetIso(d))).toBe(d.getTime());
  });
  it("uses the real time when nothing was chosen, and accepts a close choice without a note", () => {
    expect(resolveDateTimeResponse(undefined, NOW)).toMatchObject({ value: NOW, chosen: null, adjusted: false, problem: null });
    const r = resolveDateTimeResponse("2026-11-04T14:03:00-08:00", NOW);
    expect(r).toMatchObject({ value: "2026-11-04T14:03:00-08:00", adjusted: false, problem: null });
  });
  it("notes an adjusted time, and refuses one that is unreadable or out of range", () => {
    expect(resolveDateTimeResponse("2026-11-03T09:00:00-08:00", NOW)).toMatchObject({ adjusted: true, problem: null });
    expect(resolveDateTimeResponse("yesterday", NOW).problem).toMatch(/valid/);
    expect(resolveDateTimeResponse("2026-09-01T09:00:00-08:00", NOW).problem).toMatch(/last 30 days/);
    expect(resolveDateTimeResponse("2026-12-25T09:00:00-08:00", NOW).problem).toMatch(/last 30 days/);
  });
});

describe("newBlockAt anchoring", () => {
  it("puts the block's left-middle exactly on the click", () => {
    for (const spec of BLOCKS) {
      const b = newBlockAt(spec.type, 31.5, 42);
      expect(b.xPct).toBeCloseTo(31.5);
      expect(b.yPct + b.heightPct / 2).toBeCloseTo(42);
    }
  });
  it("keeps a block that would run off the page, moving it left or up", () => {
    const right = newBlockAt("signature", 95, 50);
    expect(right.xPct + right.widthPct).toBeLessThanOrEqual(100.0001);
    const bottom = newBlockAt("signature", 50, 99.5);
    expect(bottom.yPct + bottom.heightPct).toBeLessThanOrEqual(100.0001);
  });
});
