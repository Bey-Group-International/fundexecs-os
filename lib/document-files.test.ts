import {
  ACCEPTED_DOCUMENT_ATTR,
  MAX_UPLOAD_BYTES,
  checkUploadCandidate,
  documentKindLabel,
  documentNameFromFile,
  documentObjectPath,
  downloadFileName,
  fileExtension,
  formatBytes,
  isDocumentObjectPath,
  isExternalLink,
  isUploadedFile,
} from "./document-files";

const ORG = "11111111-1111-1111-1111-111111111111";
const DOC = "22222222-2222-2222-2222-222222222222";

describe("fileExtension", () => {
  it("lowercases and keeps the dot", () => {
    expect(fileExtension("Deck.PDF")).toBe(".pdf");
  });

  it("reads the last extension of a multi-dot name", () => {
    expect(fileExtension("fund.terms.v2.docx")).toBe(".docx");
  });

  it("returns empty for a dotfile or an extensionless name", () => {
    expect(fileExtension(".gitignore")).toBe("");
    expect(fileExtension("README")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
  });

  it("ignores directories in a storage key", () => {
    expect(fileExtension(`${ORG}/${DOC}/abc.pdf`)).toBe(".pdf");
  });
});

describe("isExternalLink / isUploadedFile", () => {
  it("treats http(s) values as links", () => {
    expect(isExternalLink("https://drive.example.com/x")).toBe(true);
    expect(isUploadedFile("https://drive.example.com/x")).toBe(false);
  });

  it("treats a storage path as an uploaded file", () => {
    expect(isExternalLink(`${ORG}/${DOC}/abc.pdf`)).toBe(false);
    expect(isUploadedFile(`${ORG}/${DOC}/abc.pdf`)).toBe(true);
  });

  it("does not treat a non-http scheme as a link", () => {
    // A javascript: value must never be classed as something to link out to.
    expect(isExternalLink("javascript:alert(1)")).toBe(false);
    expect(isExternalLink("data:text/html,<script>")).toBe(false);
  });

  it("reports nothing for an absent key", () => {
    expect(isExternalLink(null)).toBe(false);
    expect(isUploadedFile(null)).toBe(false);
  });
});

describe("documentKindLabel", () => {
  it("names the format of an uploaded file", () => {
    expect(documentKindLabel(`${ORG}/${DOC}/a.pdf`, false)).toBe("PDF");
    expect(documentKindLabel(`${ORG}/${DOC}/a.xlsx`, false)).toBe("Excel");
    expect(documentKindLabel(`${ORG}/${DOC}/a.pptx`, false)).toBe("Slides");
  });

  it("falls back to File for an unrecognised extension", () => {
    expect(documentKindLabel(`${ORG}/${DOC}/a.dat`, false)).toBe("File");
  });

  it("distinguishes links, written documents, and empties", () => {
    expect(documentKindLabel("https://example.com/x.pdf", false)).toBe("Link");
    expect(documentKindLabel(null, true)).toBe("Written");
    expect(documentKindLabel(null, false)).toBe("Empty");
  });
});

describe("checkUploadCandidate", () => {
  it("accepts a supported file and reports its label", () => {
    expect(checkUploadCandidate({ name: "LPA.pdf", size: 2048 })).toEqual({
      ok: true,
      ext: ".pdf",
      label: "PDF",
    });
  });

  it("accepts on extension even when the browser reports a generic MIME type", () => {
    // .xlsx routinely arrives as application/octet-stream; rejecting on that
    // would fail real uploads for no security gain.
    const result = checkUploadCandidate({
      name: "financials.xlsx",
      size: 1024,
      type: "application/octet-stream",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unsupported extension", () => {
    const result = checkUploadCandidate({ name: "payload.exe", size: 1024 });
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects an extensionless file", () => {
    expect(checkUploadCandidate({ name: "Makefile", size: 10 }).ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(checkUploadCandidate({ name: "empty.pdf", size: 0 }).ok).toBe(false);
  });

  it("rejects a file over the bucket ceiling and says both numbers", () => {
    const result = checkUploadCandidate({ name: "huge.pdf", size: MAX_UPLOAD_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("100 MB");
  });

  it("accepts a file exactly at the ceiling", () => {
    expect(checkUploadCandidate({ name: "big.pdf", size: MAX_UPLOAD_BYTES }).ok).toBe(true);
  });
});

describe("documentObjectPath / isDocumentObjectPath", () => {
  it("round-trips a minted path", () => {
    const path = documentObjectPath(ORG, DOC, "abc-123", ".pdf");
    expect(path).toBe(`${ORG}/${DOC}/abc-123.pdf`);
    expect(isDocumentObjectPath(path, ORG, DOC)).toBe(true);
  });

  it("rejects a path belonging to another org or document", () => {
    const path = documentObjectPath(ORG, DOC, "abc", ".pdf");
    expect(isDocumentObjectPath(path, "33333333-3333-3333-3333-333333333333", DOC)).toBe(false);
    expect(isDocumentObjectPath(path, ORG, "44444444-4444-4444-4444-444444444444")).toBe(false);
  });

  it("rejects traversal, absolute paths, and wrong depth", () => {
    expect(isDocumentObjectPath(`${ORG}/${DOC}/../../x.pdf`, ORG, DOC)).toBe(false);
    expect(isDocumentObjectPath(`/${ORG}/${DOC}/x.pdf`, ORG, DOC)).toBe(false);
    expect(isDocumentObjectPath(`${ORG}/${DOC}/nested/x.pdf`, ORG, DOC)).toBe(false);
    expect(isDocumentObjectPath(`${ORG}/${DOC}`, ORG, DOC)).toBe(false);
  });

  it("rejects a path whose file is not a supported type", () => {
    expect(isDocumentObjectPath(`${ORG}/${DOC}/x.exe`, ORG, DOC)).toBe(false);
    expect(isDocumentObjectPath(`${ORG}/${DOC}/.hidden`, ORG, DOC)).toBe(false);
  });
});

describe("formatBytes", () => {
  it("scales through the units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe("100 MB");
  });

  it("renders an unknown size as a dash rather than 0", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });
});

describe("documentNameFromFile", () => {
  it("drops the extension and restores separators", () => {
    expect(documentNameFromFile("Q3_2026-audited-financials.pdf")).toBe(
      "Q3 2026 audited financials",
    );
  });

  it("keeps a name that has nothing to clean", () => {
    expect(documentNameFromFile("Investor Deck.pptx")).toBe("Investor Deck");
  });

  it("never returns an empty name", () => {
    // A dotfile has no extension to strip, so the leading dot is separator
    // cleanup, not truncation. checkUploadCandidate rejects these anyway.
    expect(documentNameFromFile(".pdf")).toBe("pdf");
    expect(documentNameFromFile("   ")).toBe("Untitled document");
  });
});

describe("ACCEPTED_DOCUMENT_ATTR", () => {
  it("lists every supported extension for the file input", () => {
    expect(ACCEPTED_DOCUMENT_ATTR).toContain(".pdf");
    expect(ACCEPTED_DOCUMENT_ATTR).toContain(".xlsx");
    expect(ACCEPTED_DOCUMENT_ATTR).not.toContain(".exe");
  });
});

describe("downloadFileName", () => {
  it("appends the stored object's extension to the document name", () => {
    expect(downloadFileName("Fund IV LPA", `${ORG}/${DOC}/abc.pdf`)).toBe("Fund IV LPA.pdf");
  });

  it("does not double the extension when the name already carries it", () => {
    expect(downloadFileName("financials.xlsx", `${ORG}/${DOC}/abc.xlsx`)).toBe("financials.xlsx");
    expect(downloadFileName("Financials.XLSX", `${ORG}/${DOC}/abc.xlsx`)).toBe("Financials.XLSX");
  });

  it("strips path separators so a name cannot steer the saved file", () => {
    expect(downloadFileName("../../etc/passwd", `${ORG}/${DOC}/abc.pdf`)).toBe(
      "..-..-etc-passwd.pdf",
    );
  });

  it("falls back to a usable name when there is nothing left", () => {
    expect(downloadFileName("   ", `${ORG}/${DOC}/abc.pdf`)).toBe("document.pdf");
  });
});
