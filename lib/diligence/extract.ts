import 'server-only';
import { inflateRawSync, inflateSync } from 'node:zlib';

const XML_TEXT_FILES = {
  docx: /^word\/document\.xml$/,
  pptx: /^ppt\/slides\/slide\d+\.xml$/,
  xlsxShared: /^xl\/sharedStrings\.xml$/,
  xlsxSheet: /^xl\/worksheets\/sheet\d+\.xml$/
};

type SupportedKind = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'text';

interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface TextChunk {
  content: string;
  index: number;
}

export function chunkText(
  text: string,
  options: { targetTokens?: number; overlapTokens?: number } = {}
): TextChunk[] {
  const targetTokens = options.targetTokens ?? 900;
  const overlapTokens = options.overlapTokens ?? 120;
  const words = normalizeWhitespace(text).split(' ').filter(Boolean);
  if (words.length === 0) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + targetTokens, words.length);
    chunks.push({ index: chunks.length, content: words.slice(start, end).join(' ') });
    if (end === words.length) break;
    start = Math.max(end - overlapTokens, start + 1);
  }
  return chunks;
}

export function extractTextFromDiligenceFile(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): string {
  const kind = detectKind(input.fileName, input.mimeType);
  switch (kind) {
    case 'text':
      return normalizeWhitespace(input.buffer.toString('utf8'));
    case 'docx':
      return extractDocx(input.buffer);
    case 'pptx':
      return extractPptx(input.buffer);
    case 'xlsx':
      return extractXlsx(input.buffer);
    case 'pdf':
      return extractPdf(input.buffer);
  }
}

function detectKind(fileName: string, mimeType: string): SupportedKind {
  const lower = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('text/') || ['application/json', 'text/csv'].includes(mime)) return 'text';
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) return 'text';
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    lower.endsWith('.pptx')
  ) {
    return 'pptx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    lower.endsWith('.xlsx')
  ) {
    return 'xlsx';
  }
  throw new Error(`Unsupported diligence document type: ${mimeType || fileName}`);
}

function extractDocx(buffer: Buffer): string {
  const entry = readZip(buffer).find((file) => XML_TEXT_FILES.docx.test(file.name));
  if (!entry) throw new Error('DOCX document.xml not found.');
  return xmlToText(entry.data.toString('utf8'));
}

function extractPptx(buffer: Buffer): string {
  const slides = readZip(buffer)
    .filter((file) => XML_TEXT_FILES.pptx.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (slides.length === 0) throw new Error('PPTX slides not found.');
  return normalizeWhitespace(
    slides.map((slide) => xmlToText(slide.data.toString('utf8'))).join('\n\n')
  );
}

function extractXlsx(buffer: Buffer): string {
  const files = readZip(buffer);
  const shared = files.find((file) => XML_TEXT_FILES.xlsxShared.test(file.name));
  const sheets = files
    .filter((file) => XML_TEXT_FILES.xlsxSheet.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!shared && sheets.length === 0) throw new Error('XLSX worksheet text not found.');

  const parts = [
    shared ? xmlToText(shared.data.toString('utf8')) : '',
    ...sheets.map((sheet) => xmlToText(sheet.data.toString('utf8')))
  ];
  return normalizeWhitespace(parts.join('\n\n'));
}

function extractPdf(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const parts: string[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(raw))) {
    const streamStart = match.index;
    const dictStart = raw.lastIndexOf('<<', streamStart);
    const dict = dictStart >= 0 ? raw.slice(dictStart, streamStart) : '';
    let data = Buffer.from(match[1], 'latin1');
    if (dict.includes('/FlateDecode')) {
      try {
        data = inflateSync(data);
      } catch {
        continue;
      }
    }
    parts.push(extractPdfStringLiterals(data.toString('latin1')));
  }

  const text = normalizeWhitespace(parts.join(' '));
  return text || normalizeWhitespace(extractPdfStringLiterals(raw));
}

function extractPdfStringLiterals(input: string): string {
  const parts: string[] = [];
  const literalPattern = /\((?:\\.|[^\\()]){2,}\)/g;
  const hexPattern = /<([0-9a-fA-F\s]{4,})>/g;
  let match: RegExpExecArray | null;

  while ((match = literalPattern.exec(input))) {
    parts.push(decodePdfLiteral(match[0].slice(1, -1)));
  }
  while ((match = hexPattern.exec(input))) {
    parts.push(decodePdfHex(match[1]));
  }
  return parts.join(' ');
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\\d{1,3}/g, ' ');
}

function decodePdfHex(value: string): string {
  const hex = value.replace(/\s+/g, '');
  if (hex.length < 4) return '';
  const even = hex.length % 2 === 0 ? hex : `${hex}0`;
  const bytes = Buffer.from(even, 'hex');
  const utf16 = bytes.length > 1 && bytes[0] === 0xfe && bytes[1] === 0xff;
  return utf16 ? bytes.subarray(2).swap16().toString('utf16le') : bytes.toString('utf8');
}

function readZip(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const data = readLocalZipEntry(buffer, localOffset, compressedSize, method);
    if (data) entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readLocalZipEntry(
  buffer: Buffer,
  offset: number,
  compressedSize: number,
  method: number
): Buffer | null {
  if (buffer.readUInt32LE(offset) !== 0x04034b50) return null;
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + compressedSize);
  if (method === 0) return compressed;
  if (method === 8) return inflateRawSync(compressed);
  return null;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('Invalid ZIP/OOXML file.');
}

function xmlToText(xml: string): string {
  return normalizeWhitespace(
    decodeXmlEntities(
      xml
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
  );
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
