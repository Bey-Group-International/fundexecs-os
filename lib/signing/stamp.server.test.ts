jest.mock("server-only", () => ({}), { virtual: true });
import { PDFDocument } from "pdf-lib";
import { stampBlocks } from "./stamp.server";
import { buildDocumentPdf } from "./executed-pdf.server";
import { BLOCKS, BLOCK_HEIGHT_PCT, BLOCK_WIDTH_PCT, resolveDateTimeResponse, toOffsetIso, blockSpec, clampBlock, newBlockAt, formatBlockDateTime } from "./blocks";
import { missingRequiredFields } from "../envelope-signing";
import { blockValueProblem } from "./blocks";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("blocks", () => {
  it("offers exactly these blocks, and old types behave like their nearest block", () => {
    expect(BLOCKS.map((b) => b.type)).toEqual(["name", "signature", "datetime", "company", "title", "address", "email", "phone"]);
    expect(blockSpec("initials")?.type).toBe("signature");
    expect(blockSpec("date")?.type).toBe("datetime");
    expect(blockSpec("nope")).toBeNull();
  });

  it("keeps a block wholly on its page, whatever the browser sends", () => {
    const b = clampBlock({ xPct: 98, yPct: -5, widthPct: 30, heightPct: 4 });
    expect(b.xPct).toBe(70);
    expect(b.yPct).toBe(0);
    expect(clampBlock({ xPct: NaN, yPct: NaN, widthPct: NaN, heightPct: NaN }).widthPct).toBe(20);
  });

  it("centres a new block on the click", () => {
    const b = newBlockAt("signature", 50, 50);
    expect(b.xPct + b.widthPct / 2).toBeCloseTo(50);
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
