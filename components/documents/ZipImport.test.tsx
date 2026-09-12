/**
 * A zip is somebody else's filing of somebody else's material, so the import
 * proposes rather than applies: these tests pin that the archive's folders are
 * read as sections, that a file the library cannot store is reported with a
 * reason instead of vanishing, and that nothing is uploaded until the operator
 * presses Import.
 */
type UploadArgs = [supabase: unknown, input: { file: File; section: string; documentId?: string }];
type UploadResult = { ok: true; documentId: string } | { ok: false; error: string };

const uploadDocumentFile = jest.fn(
  async (..._args: UploadArgs): Promise<UploadResult> => ({ ok: true, documentId: "d1" }),
);
jest.mock("./DocumentUploader", () => ({
  uploadDocumentFile: (...args: UploadArgs) => uploadDocumentFile(...args),
}));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { ZipImport } from "./ZipImport";

// A real STORE-method archive, so the production central-directory reader is
// what parses the fixture.
function makeZip(files: { name: string; data: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameB = enc.encode(f.name);
    const dataB = enc.encode(f.data);

    const lh = new Uint8Array(30 + nameB.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(18, dataB.length, true);
    lv.setUint32(22, dataB.length, true);
    lv.setUint16(26, nameB.length, true);
    lh.set(nameB, 30);
    parts.push(lh, dataB);

    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(20, dataB.length, true);
    cv.setUint32(24, dataB.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    central.push(ch);
    offset += lh.length + dataB.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, eocd];
  const total = all.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

function zipFile(files: { name: string; data: string }[], name = "pack.zip"): File {
  return new File([makeZip(files) as BlobPart], name, { type: "application/zip" });
}

const PACK = [
  { name: "Fund Terms/LPA.pdf", data: "lpa" },
  { name: "Fund Terms/Fee Schedule.pdf", data: "fees" },
  { name: "Financials/Audit 2025.pdf", data: "audit" },
];

function renderImport(file: File, onClose = jest.fn()) {
  render(<ZipImport file={file} defaultSection="other" onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  uploadDocumentFile.mockClear();
  refresh.mockClear();
});

describe("ZipImport", () => {
  it("reads the archive's folders as sections", async () => {
    renderImport(zipFile(PACK));

    await screen.findByText("LPA");
    // The header also carries the archive size, so match the summary within it.
    expect(screen.getByText(/3 documents across 2 sections/)).toBeInTheDocument();
    // Grouped under the sections the folder names imply, not under the fallback.
    // Queried as headings: every section label also appears in the per-row
    // section <select>, so a plain text query would match those too.
    expect(screen.getByRole("heading", { name: /Fund Terms/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Financials & Audits/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Other Materials/ }),
    ).not.toBeInTheDocument();
  });

  it("uploads nothing until Import is pressed", async () => {
    renderImport(zipFile(PACK));
    await screen.findByText("LPA");

    expect(uploadDocumentFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Import 3 documents/ }));
    await waitFor(() => expect(uploadDocumentFile).toHaveBeenCalledTimes(3));
  });

  it("files each entry under the section shown for it", async () => {
    renderImport(zipFile(PACK));
    await screen.findByText("LPA");

    fireEvent.click(screen.getByRole("button", { name: /Import 3 documents/ }));
    await waitFor(() => expect(uploadDocumentFile).toHaveBeenCalledTimes(3));

    const sections = uploadDocumentFile.mock.calls.map((c) => c[1].section);
    expect(sections.filter((s) => s === "fund_terms")).toHaveLength(2);
    expect(sections).toContain("financials");
  });

  it("honours a section the operator overrides", async () => {
    renderImport(zipFile(PACK));
    await screen.findByText("LPA");

    fireEvent.change(screen.getByLabelText("Section for LPA"), {
      target: { value: "legal" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import 3 documents/ }));
    await waitFor(() => expect(uploadDocumentFile).toHaveBeenCalledTimes(3));

    const call = uploadDocumentFile.mock.calls.find((c) => c[1].file.name === "LPA.pdf");
    expect(call?.[1].section).toBe("legal");
  });

  it("skips a deselected entry", async () => {
    renderImport(zipFile(PACK));
    await screen.findByText("LPA");

    fireEvent.click(screen.getByLabelText("Import LPA"));
    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Import 2 documents/ }));
    await waitFor(() => expect(uploadDocumentFile).toHaveBeenCalledTimes(2));
    const names = uploadDocumentFile.mock.calls.map((c) => c[1].file.name);
    expect(names).not.toContain("LPA.pdf");
  });

  it("reports an unstorable file as skipped, with the reason", async () => {
    // Silently dropping it would be indistinguishable from a working import.
    renderImport(zipFile([...PACK, { name: "bin/tool.exe", data: "MZ" }]));
    await screen.findByText("LPA");

    const skipped = screen.getByText(/1 file skipped/);
    fireEvent.click(skipped);
    expect(screen.getByText(/bin\/tool\.exe/)).toBeInTheDocument();
    expect(screen.getByText(/can't be stored/)).toBeInTheDocument();
    // And it is not offered for import.
    expect(screen.getByRole("button", { name: /Import 3 documents/ })).toBeInTheDocument();
  });

  it("flags a fallback section rather than presenting it as known", async () => {
    renderImport(zipFile([{ name: "Assorted/notes.pdf", data: "x" }]));
    await screen.findByText("notes");
    expect(screen.getByText("Guessed")).toBeInTheDocument();
  });

  it("does not flag a section the archive actually named", async () => {
    renderImport(zipFile(PACK));
    await screen.findByText("LPA");
    expect(screen.queryByText("Guessed")).not.toBeInTheDocument();
  });

  it("passes each entry's real bytes through, named for upload", async () => {
    renderImport(zipFile([{ name: "Legal/Deed.pdf", data: "deed-bytes" }]));
    await screen.findByText("Deed");

    fireEvent.click(screen.getByRole("button", { name: /Import 1 document/ }));
    await waitFor(() => expect(uploadDocumentFile).toHaveBeenCalledTimes(1));

    const sent = uploadDocumentFile.mock.calls[0][1].file;
    expect(sent.name).toBe("Deed.pdf"); // extension kept, so validation passes
    await expect(sent.text()).resolves.toBe("deed-bytes");
  });

  it("reports a per-file failure without claiming success", async () => {
    uploadDocumentFile.mockResolvedValueOnce({ ok: false, error: "Storage unavailable" });
    renderImport(zipFile([{ name: "Legal/Deed.pdf", data: "x" }]));
    await screen.findByText("Deed");

    fireEvent.click(screen.getByRole("button", { name: /Import 1 document/ }));
    await screen.findByText("Imported 0 of 1 documents.");
    expect(screen.getByText(/Deed — Storage unavailable/)).toBeInTheDocument();
  });

  it("explains a file that is not a readable archive", async () => {
    const bad = new File([new TextEncoder().encode("not a zip") as BlobPart], "broken.zip");
    renderImport(bad);
    await screen.findByText("That file isn't a readable zip archive.");
  });

  it("says plainly when an archive holds nothing filable", async () => {
    renderImport(zipFile([{ name: "bin/tool.exe", data: "MZ" }]));
    await screen.findByText("Nothing in this archive can be filed as a document.");
    expect(screen.queryByRole("button", { name: /^Import/ })).not.toBeInTheDocument();
  });
});
