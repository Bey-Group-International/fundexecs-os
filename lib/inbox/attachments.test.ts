import {
  MAX_ATTACHMENTS,
  attachmentPath,
  formatFileSize,
  isOrgAttachmentPath,
  linkedFilesText,
  parseAttachmentRefs,
  splitBySize,
} from "./attachments";

const ORG = "org-1";
const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("attachmentPath", () => {
  it("files the upload under the org and a fresh id", () => {
    expect(attachmentPath(ORG, ID, "Deck.pdf")).toBe(`${ORG}/${ID}/Deck.pdf`);
  });

  it("cannot climb out of the org's prefix", () => {
    const p = attachmentPath(ORG, ID, "../../other-org/x/secret.pdf");
    expect(p.split("/")).toHaveLength(3);
    expect(isOrgAttachmentPath(ORG, p)).toBe(true);
  });

  it("names an unnamed file", () => {
    expect(attachmentPath(ORG, ID, "")).toBe(`${ORG}/${ID}/file`);
  });
});

describe("isOrgAttachmentPath", () => {
  it("accepts the org's own upload", () => {
    expect(isOrgAttachmentPath(ORG, `${ORG}/${ID}/a.pdf`)).toBe(true);
  });

  it("refuses another org's upload, a short path, or a traversal", () => {
    expect(isOrgAttachmentPath(ORG, `org-2/${ID}/a.pdf`)).toBe(false);
    expect(isOrgAttachmentPath(ORG, `${ORG}/a.pdf`)).toBe(false);
    expect(isOrgAttachmentPath(ORG, `${ORG}/not-a-uuid/a.pdf`)).toBe(false);
    expect(isOrgAttachmentPath(ORG, `${ORG}/${ID}/..`)).toBe(false);
    expect(isOrgAttachmentPath(ORG, `${ORG}/${ID}/a/../b`)).toBe(false);
    expect(isOrgAttachmentPath(ORG, `${ORG}/${ID}/Q3..final.pdf`)).toBe(true);
  });
});

describe("parseAttachmentRefs", () => {
  const upload = { kind: "upload", path: `${ORG}/${ID}/a.pdf`, name: "a.pdf", size: 10, mimeType: "application/pdf" };
  const doc = { kind: "document", documentId: "d1", name: "Memo.docx", size: 5, mimeType: "application/msword" };

  it("reads the composer's JSON", () => {
    expect(parseAttachmentRefs(JSON.stringify([upload, doc]))).toEqual([upload, doc]);
  });

  it("drops malformed entries and bad JSON", () => {
    expect(parseAttachmentRefs("{nope")).toEqual([]);
    expect(parseAttachmentRefs({})).toEqual([]);
    expect(parseAttachmentRefs([null, { kind: "upload", name: "x" }, { kind: "other", name: "y" }, upload])).toEqual([upload]);
  });

  it("defaults a missing type and caps the count", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 5 }, (_, i) => ({ ...doc, documentId: `d${i}`, mimeType: "" }));
    const out = parseAttachmentRefs(many);
    expect(out).toHaveLength(MAX_ATTACHMENTS);
    expect(out[0].mimeType).toBe("application/octet-stream");
  });
});

describe("splitBySize", () => {
  it("attaches smallest first and links what does not fit", () => {
    const files = [
      { name: "big", size: 15 },
      { name: "small", size: 2 },
      { name: "mid", size: 6 },
    ];
    const { attach, link } = splitBySize(files, 10);
    expect(attach.map((f) => f.name)).toEqual(["small", "mid"]);
    expect(link.map((f) => f.name)).toEqual(["big"]);
  });

  it("attaches everything under the limit", () => {
    expect(splitBySize([{ size: 1 }, { size: 2 }], 10).link).toEqual([]);
  });
});

describe("formatFileSize", () => {
  it("reads like a file browser", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatFileSize(40 * 1024 * 1024)).toBe("40 MB");
  });
});

describe("linkedFilesText", () => {
  it("is empty without links", () => {
    expect(linkedFilesText([])).toBe("");
  });

  it("lists each link with its size and how long it lasts", () => {
    const text = linkedFilesText([{ name: "Deck.pdf", size: 30 * 1024 * 1024, url: "https://x/y" }]);
    expect(text).toContain("valid 7 days");
    expect(text).toContain("• Deck.pdf (30 MB): https://x/y");
  });
});
