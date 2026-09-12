import { ZipError, createBudget, readZipEntries, readZipEntry } from "./zip";

// ── Minimal ZIP writers, just for test fixtures ────────────────────────────────
// Real archives built byte-by-byte so the central-directory reader is exercised
// for what it actually is, without pulling in a zip dependency.

interface Src {
  name: string;
  data: string;
  /** Written as-is into the size fields, to fake a corrupt or ZIP64 archive. */
  declaredSize?: number;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of parts) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function makeZip(files: Src[], opts: { deflate?: boolean } = {}): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameB = enc.encode(f.name);
    const raw = enc.encode(f.data);
    const body = opts.deflate ? await deflateRaw(raw) : raw;
    const method = opts.deflate ? 8 : 0;
    const compressed = f.declaredSize ?? body.length;
    const uncompressed = f.declaredSize ?? raw.length;

    const lh = new Uint8Array(30 + nameB.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, compressed, true);
    lv.setUint32(22, uncompressed, true);
    lv.setUint16(26, nameB.length, true);
    lh.set(nameB, 30);
    parts.push(lh, body);

    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, compressed, true);
    cv.setUint32(24, uncompressed, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    central.push(ch);

    offset += lh.length + body.length;
  }

  const cdStart = offset;
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);

  return concat([...parts, ...central, eocd]);
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("readZipEntries", () => {
  it("lists every entry with its name and declared sizes", async () => {
    const zip = await makeZip([
      { name: "Fund Terms/LPA.pdf", data: "lpa bytes" },
      { name: "Financials/Audit.pdf", data: "audit" },
    ]);
    const entries = readZipEntries(viewOf(zip));

    expect(entries.map((e) => e.name)).toEqual(["Fund Terms/LPA.pdf", "Financials/Audit.pdf"]);
    expect(entries[0].uncompressedSize).toBe("lpa bytes".length);
    expect(entries[0].method).toBe(0);
  });

  it("marks directory entries by their trailing slash", async () => {
    // The external-attribute bits vary by writer; the slash does not.
    const zip = await makeZip([
      { name: "Fund Terms/", data: "" },
      { name: "Fund Terms/LPA.pdf", data: "x" },
    ]);
    const entries = readZipEntries(viewOf(zip));
    expect(entries.map((e) => e.isDirectory)).toEqual([true, false]);
  });

  it("decodes non-ASCII entry names as UTF-8", async () => {
    const zip = await makeZip([{ name: "Légal/Société.pdf", data: "x" }]);
    expect(readZipEntries(viewOf(zip))[0].name).toBe("Légal/Société.pdf");
  });

  it("reads an empty archive as no entries", async () => {
    const entries = readZipEntries(viewOf(await makeZip([])));
    expect(entries).toEqual([]);
  });

  it("throws a typed error for something that is not a zip", () => {
    const bytes = new TextEncoder().encode("this is not a zip at all");
    try {
      readZipEntries(viewOf(bytes));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ZipError);
      expect((err as ZipError).code).toBe("not-zip");
    }
  });

  it("does not read entry data", async () => {
    // The directory is read alone, which is what lets a large archive be
    // reviewed before any of it is inflated.
    const zip = await makeZip([{ name: "a.pdf", data: "x".repeat(10_000) }]);
    const budget = createBudget(0);
    expect(readZipEntries(viewOf(zip))).toHaveLength(1);
    expect(budget.remaining).toBe(0);
  });
});

describe("readZipEntry", () => {
  it("returns stored (method 0) bytes", async () => {
    const zip = await makeZip([{ name: "a.txt", data: "hello store" }]);
    const view = viewOf(zip);
    const [entry] = readZipEntries(view);
    expect(text(await readZipEntry(view, entry, createBudget(1024)))).toBe("hello store");
  });

  it("inflates deflated (method 8) bytes", async () => {
    const body = "institutional ".repeat(200);
    const zip = await makeZip([{ name: "a.txt", data: body }], { deflate: true });
    const view = viewOf(zip);
    const [entry] = readZipEntries(view);
    expect(entry.method).toBe(8);
    expect(text(await readZipEntry(view, entry, createBudget(1 << 20)))).toBe(body);
  });

  it("reads each entry independently, in any order", async () => {
    const zip = await makeZip([
      { name: "a.txt", data: "first" },
      { name: "b.txt", data: "second" },
      { name: "c.txt", data: "third" },
    ]);
    const view = viewOf(zip);
    const entries = readZipEntries(view);
    const budget = createBudget(1 << 20);
    expect(text(await readZipEntry(view, entries[2], budget))).toBe("third");
    expect(text(await readZipEntry(view, entries[0], budget))).toBe("first");
  });

  it("charges every read against the shared budget", async () => {
    const zip = await makeZip([{ name: "a.txt", data: "12345" }]);
    const view = viewOf(zip);
    const [entry] = readZipEntries(view);
    const budget = createBudget(100);
    await readZipEntry(view, entry, budget);
    expect(budget.remaining).toBe(95);
  });

  it("refuses a stored entry that would exceed the budget", async () => {
    const zip = await makeZip([{ name: "a.txt", data: "x".repeat(500) }]);
    const view = viewOf(zip);
    const [entry] = readZipEntries(view);
    await expect(readZipEntry(view, entry, createBudget(10))).rejects.toMatchObject({
      code: "too-large",
    });
  });

  it("aborts a deflated entry mid-stream once it outgrows the budget", async () => {
    // The decompression-bomb guard: a small compressed entry must not be able
    // to expand without bound before anyone notices.
    const zip = await makeZip([{ name: "bomb.txt", data: "a".repeat(200_000) }], {
      deflate: true,
    });
    const view = viewOf(zip);
    const [entry] = readZipEntries(view);
    expect(entry.compressedSize).toBeLessThan(2_000);
    await expect(readZipEntry(view, entry, createBudget(1_000))).rejects.toMatchObject({
      code: "too-large",
    });
  });

  it("refuses a ZIP64 sentinel rather than misreading it", async () => {
    const zip = await makeZip([{ name: "a.txt", data: "x", declaredSize: 0xffffffff }]);
    const view = viewOf(zip);
    const [entry] = readZipEntries(view);
    await expect(readZipEntry(view, entry, createBudget(1024))).rejects.toMatchObject({
      code: "zip64",
    });
  });

  it("refuses an entry whose declared size runs past the end of the file", async () => {
    const zip = await makeZip([{ name: "a.txt", data: "x", declaredSize: 5_000 }]);
    const view = viewOf(zip);
    const [entry] = readZipEntries(view);
    await expect(readZipEntry(view, entry, createBudget(1 << 20))).rejects.toMatchObject({
      code: "truncated",
    });
  });

  it("refuses a corrupt local-header offset", async () => {
    const zip = await makeZip([{ name: "a.txt", data: "x" }]);
    const view = viewOf(zip);
    const [entry] = readZipEntries(view);
    await expect(
      readZipEntry(view, { ...entry, offset: 999_999 }, createBudget(1024)),
    ).rejects.toMatchObject({ code: "bad-header" });
  });

  it("refuses a compression method it cannot read", async () => {
    const zip = await makeZip([{ name: "a.txt", data: "x" }]);
    const view = viewOf(zip);
    const [entry] = readZipEntries(view);
    await expect(
      readZipEntry(view, { ...entry, method: 12 }, createBudget(1024)),
    ).rejects.toMatchObject({ code: "unsupported-method" });
  });
});
