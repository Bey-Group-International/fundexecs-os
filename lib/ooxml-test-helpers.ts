// Test-only: build a real deflated ZIP so the production reader parses it.
import { deflateRawSync } from "node:zlib";

export function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const nameB = Buffer.from(name, "utf8");
    const raw = Buffer.from(body, "utf8");
    const data = deflateRawSync(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

export const DOCX = {
  "word/document.xml":
    '<w:document><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Fund IV Terms</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Management fee: </w:t></w:r><w:r><w:t>2% &amp; 20% carry</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Hurdle 8%</w:t></w:r></w:p>' +
    '<w:p/>' +
    '</w:body></w:document>',
};

export const XLSX = {
  "xl/workbook.xml": '<workbook><sheets><sheet name="Returns &amp; NAV" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels":
    '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
  "xl/sharedStrings.xml": "<sst><si><t>Deal</t></si><si><t>IRR</t></si><si><r><t>Atlas</t></r><r><t> Holdings</t></r></si></sst>",
  "xl/worksheets/sheet1.xml":
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>0.215</v></c></row>' +
    '</sheetData></worksheet>',
};

export const PPTX = {
  "ppt/presentation.xml": '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
  "ppt/_rels/presentation.xml.rels":
    '<Relationships><Relationship Id="rId2" Type="x" Target="slides/slide1.xml"/></Relationships>',
  "ppt/slides/slide1.xml":
    '<p:sld><p:cSld><p:spTree>' +
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Why now</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:sp><p:txBody><a:p><a:r><a:t>Rates peaked</a:t></a:r></a:p><a:p><a:r><a:t>Sellers motivated</a:t></a:r></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld></p:sld>',
};
