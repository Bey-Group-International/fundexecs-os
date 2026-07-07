import {
  detectSignature,
  detectFileType,
  validateFileType,
  decodeText,
  parseCSV,
  normalizeInstitutionalFormat,
  returnUserFacingErrors,
  UNSUPPORTED_FILE_MESSAGE,
  MAX_UPLOAD_BYTES,
  type SchemaField,
} from "./file-validation";

const ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const OLE_HEAD = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const TEXT_HEAD = new TextEncoder().encode("First Name,Last Name,Email\nAda,Lovelace,ada@x.com");
const BINARY_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]); // PNG-ish w/ NUL

describe("detectSignature", () => {
  it("recognizes ZIP, OLE, text, and binary heads", () => {
    expect(detectSignature(ZIP_HEAD)).toBe("zip");
    expect(detectSignature(OLE_HEAD)).toBe("ole");
    expect(detectSignature(TEXT_HEAD)).toBe("text");
    expect(detectSignature(BINARY_HEAD)).toBe("binary");
    expect(detectSignature(new Uint8Array())).toBe("unknown");
  });
});

describe("detectFileType", () => {
  it("classifies by signature over extension", () => {
    // A .csv that is really a zip is detected as not-csv.
    const d = detectFileType({ name: "contacts.csv", mime: "text/csv", head: ZIP_HEAD });
    expect(d.byExtension).toBe("csv");
    expect(d.signature).toBe("zip");
    expect(d.kind).toBeNull();
  });

  it("classifies a genuine xlsx", () => {
    const d = detectFileType({ name: "book.xlsx", mime: "", head: ZIP_HEAD });
    expect(d.kind).toBe("xlsx");
  });

  it("falls back to extension when no bytes are supplied", () => {
    expect(detectFileType({ name: "x.csv" }).kind).toBe("csv");
    expect(detectFileType({ name: "x.xlsx" }).kind).toBe("xlsx");
  });
});

describe("validateFileType", () => {
  it("accepts a genuine CSV", () => {
    const r = validateFileType({ name: "list.csv", mime: "text/csv", head: TEXT_HEAD });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("csv");
    expect(r.error).toBeNull();
  });

  it("accepts a genuine XLSX", () => {
    const r = validateFileType({ name: "list.xlsx", mime: "", head: ZIP_HEAD });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("xlsx");
  });

  it("rejects an unsupported type with the canonical message", () => {
    const r = validateFileType({ name: "notes.txt", mime: "text/plain", head: TEXT_HEAD });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(UNSUPPORTED_FILE_MESSAGE);
  });

  it("rejects a PDF/PNG/binary upload", () => {
    const r = validateFileType({ name: "chart.png", mime: "image/png", head: BINARY_HEAD });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(UNSUPPORTED_FILE_MESSAGE);
  });

  it("detects a .csv that is really an Excel/zip file", () => {
    const r = validateFileType({ name: "book.csv", mime: "text/csv", head: ZIP_HEAD });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Excel\/ZIP/i);
  });

  it("detects a .xlsx that is really plain text", () => {
    const r = validateFileType({ name: "book.xlsx", mime: "", head: TEXT_HEAD });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/plain text/i);
  });

  it("detects a legacy .xls (OLE) masquerading as .xlsx", () => {
    const r = validateFileType({ name: "old.xlsx", mime: "", head: OLE_HEAD });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/legacy Excel/i);
  });

  it("honours a restricted accept list", () => {
    const r = validateFileType({ name: "list.xlsx", mime: "", head: ZIP_HEAD }, { accept: ["csv"] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/only CSV/i);
  });
});

describe("parseCSV", () => {
  it("parses quoted fields, escaped quotes, and embedded newlines", () => {
    const rows = parseCSV('a,b,c\n"x,y","he said ""hi""","line1\nline2"\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x,y", 'he said "hi"', "line1\nline2"],
    ]);
  });

  it("strips a BOM and drops blank rows", () => {
    const rows = parseCSV("﻿a,b\n\n1,2\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("normalizeInstitutionalFormat", () => {
  const schema: SchemaField[] = [
    { key: "first_name", label: "First Name", aliases: ["fname", "given name"], required: true },
    { key: "last_name", label: "Last Name", aliases: ["surname"], required: true },
    { key: "email", label: "Email", aliases: ["email address"] },
  ];

  it("auto-maps headers by alias, reorders to schema order, and validates required fields", () => {
    const rows = [
      ["Email Address", "Surname", "FName"], // messy order + casing + aliases
      ["ada@x.com", "Lovelace", "Ada"],
    ];
    const out = normalizeInstitutionalFormat(rows, schema);
    expect(out.errors).toEqual([]);
    expect(out.columns).toEqual(["first_name", "last_name", "email"]);
    expect(out.header).toEqual(["First Name", "Last Name", "Email"]);
    expect(out.matrix).toEqual([["Ada", "Lovelace", "ada@x.com"]]);
    expect(out.records[0]).toEqual({ first_name: "Ada", last_name: "Lovelace", email: "ada@x.com" });
  });

  it("reports a missing required column", () => {
    const out = normalizeInstitutionalFormat([["First Name", "Email"], ["Ada", "ada@x.com"]], schema);
    expect(out.errors.some((e) => /Last Name/.test(e))).toBe(true);
  });

  it("reports a required column that is present but entirely empty", () => {
    const out = normalizeInstitutionalFormat(
      [["First Name", "Last Name"], ["Ada", ""], ["Grace", ""]],
      schema,
    );
    expect(out.errors.some((e) => /Last Name.*every row is empty/.test(e))).toBe(true);
  });

  it("warns about unmapped columns", () => {
    const out = normalizeInstitutionalFormat(
      [["First Name", "Last Name", "Zodiac"], ["Ada", "Lovelace", "Sagittarius"]],
      schema,
    );
    expect(out.warnings.some((w) => /Zodiac/.test(w))).toBe(true);
  });
});

// UTF-16LE-with-BOM bytes for the given string (how Excel exports "CSV UTF-8").
function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + i * 2] = c & 0xff;
    out[2 + i * 2 + 1] = (c >> 8) & 0xff;
  }
  return out;
}
function utf16be(s: string): Uint8Array {
  const le = utf16le(s);
  le[0] = 0xfe;
  le[1] = 0xff;
  for (let i = 2; i < le.length; i += 2) {
    const a = le[i];
    le[i] = le[i + 1];
    le[i + 1] = a;
  }
  return le;
}
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("a,b\n1,2")]);

describe("BOM / encoding handling", () => {
  it("treats UTF-16 and UTF-8 BOM heads as text, not binary", () => {
    expect(detectSignature(utf16le("First,Last"))).toBe("text");
    expect(detectSignature(utf16be("First,Last"))).toBe("text");
    expect(detectSignature(UTF8_BOM)).toBe("text");
  });

  it("accepts a UTF-16 .csv that would otherwise sniff as binary", () => {
    const bytes = utf16le("a,b\n1,2");
    const r = validateFileType({ name: "excel.csv", mime: "application/vnd.ms-excel", head: bytes });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("csv");
  });

  it("decodeText decodes and strips UTF-16LE/BE and UTF-8 BOMs", () => {
    expect(decodeText(utf16le("a,b\n1,2"))).toBe("a,b\n1,2");
    expect(decodeText(utf16be("a,b\n1,2"))).toBe("a,b\n1,2");
    expect(decodeText(UTF8_BOM)).toBe("a,b\n1,2");
    expect(decodeText(new TextEncoder().encode("plain,utf8"))).toBe("plain,utf8");
  });

  it("round-trips a UTF-16 CSV through decodeText + parseCSV", () => {
    const rows = parseCSV(decodeText(utf16le("Name,Email\nAda,ada@x.com")));
    expect(rows).toEqual([
      ["Name", "Email"],
      ["Ada", "ada@x.com"],
    ]);
  });
});

describe("size guard", () => {
  it("rejects a file over the default limit before parsing", () => {
    const r = validateFileType({ name: "big.csv", mime: "text/csv", head: TEXT_HEAD, size: MAX_UPLOAD_BYTES + 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/over the .* limit/i);
  });

  it("honours a custom maxBytes", () => {
    const r = validateFileType({ name: "x.csv", mime: "text/csv", head: TEXT_HEAD, size: 2000 }, { maxBytes: 1000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/limit/i);
  });

  it("accepts a file within the limit", () => {
    const r = validateFileType({ name: "x.csv", mime: "text/csv", head: TEXT_HEAD, size: 1234 });
    expect(r.ok).toBe(true);
  });
});

describe("returnUserFacingErrors", () => {
  it("returns null when there are no errors", () => {
    expect(returnUserFacingErrors([])).toBeNull();
  });

  it("returns a single message unchanged", () => {
    const r = returnUserFacingErrors(["Boom"]);
    expect(r?.message).toBe("Boom");
    expect(r?.errors).toHaveLength(1);
  });

  it("bulls-eyes multiple messages into a bulleted summary", () => {
    const r = returnUserFacingErrors(["one", "two"]);
    expect(r?.message).toMatch(/2 problems/);
    expect(r?.errors).toHaveLength(2);
  });
});
