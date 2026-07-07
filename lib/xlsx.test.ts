import { xlsxToRows, rowsToCsv } from "./xlsx";

// ── Minimal STORE-method (uncompressed) ZIP writer, just for test fixtures ──────
// Builds a real .xlsx-shaped archive so we exercise the central-directory reader
// and XML parsing without pulling in a zip dependency. STORE (method 0) skips
// inflation, keeping the fixture deterministic.

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
    lv.setUint32(18, dataB.length, true); // compressed size
    lv.setUint32(22, dataB.length, true); // uncompressed size
    lv.setUint16(26, nameB.length, true);
    lh.set(nameB, 30);
    parts.push(lh, dataB);

    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(20, dataB.length, true); // compressed size
    cv.setUint32(24, dataB.length, true); // uncompressed size
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true); // local header offset
    ch.set(nameB, 46);
    central.push(ch);

    offset += lh.length + dataB.length;
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

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// DEFLATE (method 8) variant so the inflate path is exercised end to end.
async function makeZipDeflate(files: { name: string; data: string }[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameB = enc.encode(f.name);
    const rawB = enc.encode(f.data);
    const dataB = await deflateRaw(rawB);

    const lh = new Uint8Array(30 + nameB.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true); // method: deflate
    lv.setUint32(18, dataB.length, true);
    lv.setUint32(22, rawB.length, true);
    lv.setUint16(26, nameB.length, true);
    lh.set(nameB, 30);
    parts.push(lh, dataB);

    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true); // method: deflate
    cv.setUint32(20, dataB.length, true);
    cv.setUint32(24, rawB.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    central.push(ch);

    offset += lh.length + dataB.length;
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

const SHARED_STRINGS = `<?xml version="1.0"?><sst>
  <si><t>First Name</t></si>
  <si><t>Last Name</t></si>
  <si><t>Company &amp; Co</t></si>
  <si><t>Ada</t></si>
  <si><t>Lovelace</t></si>
</sst>`;

const SHEET = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
  <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="D2"><v>42</v></c></row>
</sheetData></worksheet>`;

describe("xlsxToRows", () => {
  it("reads shared strings, inline numbers, XML entities, and column gaps", async () => {
    const zip = makeZip([
      { name: "xl/sharedStrings.xml", data: SHARED_STRINGS },
      { name: "xl/worksheets/sheet1.xml", data: SHEET },
    ]);
    const rows = await xlsxToRows(zip);
    expect(rows[0]).toEqual(["First Name", "Last Name", "Company & Co"]);
    // Row 2 skips column C, so it fills the gap with an empty string.
    expect(rows[1]).toEqual(["Ada", "Lovelace", "", "42"]);
  });

  it("inflates DEFLATE-compressed entries (method 8)", async () => {
    const zip = await makeZipDeflate([
      { name: "xl/sharedStrings.xml", data: SHARED_STRINGS },
      { name: "xl/worksheets/sheet1.xml", data: SHEET },
    ]);
    const rows = await xlsxToRows(zip);
    expect(rows[0]).toEqual(["First Name", "Last Name", "Company & Co"]);
    expect(rows[1]).toEqual(["Ada", "Lovelace", "", "42"]);
  });

  it("falls back to the first worksheet when sheet1.xml is absent", async () => {
    const zip = makeZip([
      { name: "xl/sharedStrings.xml", data: SHARED_STRINGS },
      { name: "xl/worksheets/data.xml", data: SHEET },
    ]);
    const rows = await xlsxToRows(zip);
    expect(rows[0][0]).toBe("First Name");
  });

  it("throws a readable error when there is no worksheet", async () => {
    const zip = makeZip([{ name: "xl/sharedStrings.xml", data: SHARED_STRINGS }]);
    await expect(xlsxToRows(zip)).rejects.toThrow(/worksheet/i);
  });

  it("rejects a non-zip buffer with a readable error", async () => {
    await expect(xlsxToRows(new TextEncoder().encode("not a zip"))).rejects.toThrow(/valid Excel/i);
  });
});

describe("rowsToCsv", () => {
  it("round-trips values and quotes cells that need it", () => {
    const csv = rowsToCsv([
      ["a", "b,c", 'he said "hi"'],
      ["1", "2", "3"],
    ]);
    expect(csv).toBe('a,"b,c","he said ""hi"""\n1,2,3');
  });
});
