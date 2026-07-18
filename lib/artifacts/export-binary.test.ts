import {
  renderMarkdownToDocx,
  renderMarkdownToPdf,
  renderArtifactBinary,
} from "./export-binary";

const SAMPLE = [
  "# Heading One",
  "",
  "Some **bold** text and a paragraph.",
  "",
  "- a bullet item",
  "",
  "```",
  "const x = 1;",
  "```",
].join("\n");

// A .docx is a ZIP archive: it starts with the local file header magic PK\x03\x04.
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
// A PDF starts with the ASCII bytes "%PDF-".
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  const head = Buffer.from(bytes).subarray(0, magic.length);
  return magic.every((b, i) => head[i] === b);
}

// Non-ASCII + pathological input: em-dash, euro sign, a very long line, and
// unbalanced bold markers.
const PATHOLOGICAL =
  "Title — cost is €5\n\n" +
  "**unbalanced bold and a euro € sign\n\n" +
  "x".repeat(50000) +
  "\n";

describe("renderMarkdownToDocx", () => {
  it("returns a Uint8Array with ZIP magic bytes", async () => {
    const bytes = await renderMarkdownToDocx(SAMPLE, "My Title");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    expect(startsWith(bytes, ZIP_MAGIC)).toBe(true);
  });

  it("does not throw on pathological input and still returns ZIP magic", async () => {
    const bytes = await renderMarkdownToDocx(PATHOLOGICAL);
    expect(bytes.length).toBeGreaterThan(0);
    expect(startsWith(bytes, ZIP_MAGIC)).toBe(true);
  });

  it("returns a valid buffer for empty input", async () => {
    const bytes = await renderMarkdownToDocx("");
    expect(bytes.length).toBeGreaterThan(0);
    expect(startsWith(bytes, ZIP_MAGIC)).toBe(true);
  });
});

describe("renderMarkdownToPdf", () => {
  it("returns a Uint8Array with %PDF- magic bytes", async () => {
    const bytes = await renderMarkdownToPdf(SAMPLE, "My Title");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    expect(startsWith(bytes, PDF_MAGIC)).toBe(true);
  });

  it("does not throw on pathological input and still returns PDF magic", async () => {
    const bytes = await renderMarkdownToPdf(PATHOLOGICAL);
    expect(bytes.length).toBeGreaterThan(0);
    expect(startsWith(bytes, PDF_MAGIC)).toBe(true);
    // A generous timeout on top of the O(N) hard-break: layout of a 50k-char
    // token must finish well under this even on a slow CI runner.
  }, 15000);

  it("returns a valid buffer for empty input", async () => {
    const bytes = await renderMarkdownToPdf("");
    expect(bytes.length).toBeGreaterThan(0);
    expect(startsWith(bytes, PDF_MAGIC)).toBe(true);
  });
});

describe("renderArtifactBinary", () => {
  it("dispatches to docx", async () => {
    const bytes = await renderArtifactBinary("docx", SAMPLE, "T");
    expect(startsWith(bytes, ZIP_MAGIC)).toBe(true);
  });

  it("dispatches to pdf", async () => {
    const bytes = await renderArtifactBinary("pdf", SAMPLE, "T");
    expect(startsWith(bytes, PDF_MAGIC)).toBe(true);
  });

  it("coerces non-string content to empty string", async () => {
    // @ts-expect-error deliberately passing a non-string to exercise coercion
    const docx = await renderArtifactBinary("docx", null);
    expect(startsWith(docx, ZIP_MAGIC)).toBe(true);
    // @ts-expect-error deliberately passing a non-string to exercise coercion
    const pdf = await renderArtifactBinary("pdf", undefined);
    expect(startsWith(pdf, PDF_MAGIC)).toBe(true);
  });
});
