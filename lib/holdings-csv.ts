// lib/holdings-csv.ts
// Pure CSV helpers for cap-table holdings import/export in Build › Entity ownership.
// Framework-free and unit-tested: the client component does the actual Blob
// download / FileReader, and the `importHoldingsCsv` server action consumes the
// ParsedHoldingRow[] this module produces. Parsing is tolerant of header
// casing/spacing and of missing class/units/invested columns, and handles
// quoted fields with embedded commas at a basic level.

export interface ExportHoldingRow {
  name: string;
  kind: string;
  className: string | null;
  units: number | null;
  ownershipPct: number;
  investedAmount: number | null;
}

export interface ParsedHoldingRow {
  holder: string;
  className: string | null;
  units: number | null;
  ownershipPct: number | null;
  invested: number | null;
}

const EXPORT_HEADERS = ["Holder", "Kind", "Class", "Units", "OwnershipPct", "Invested"] as const;

// Quote a field only when it needs it (comma, quote, or newline); escape any
// embedded quotes by doubling them, per RFC 4180.
function csvCell(value: string | number | null): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function holdingsToCsv(rows: ExportHoldingRow[]): string {
  const lines = [EXPORT_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.name),
        csvCell(r.kind),
        csvCell(r.className),
        csvCell(r.units),
        csvCell(r.ownershipPct),
        csvCell(r.investedAmount),
      ].join(","),
    );
  }
  return lines.join("\n");
}

// Split one CSV record into fields, honouring quoted sections and escaped ("")
// quotes. Assumes the record is a single line (no embedded newlines).
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// Coerce a raw cell to a number, stripping currency/percent/thousands noise.
function num(raw: string | undefined): number | null {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  const n = Number(v.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Map a tolerant header label (any casing/spacing/underscores) to a canonical key.
function canonicalHeader(h: string): string {
  const k = h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["holder", "name", "stakeholder"].includes(k)) return "holder";
  if (["class", "shareclass", "classname"].includes(k)) return "class";
  if (["units", "shares"].includes(k)) return "units";
  if (["ownershippct", "ownership", "pct", "percent", "ownershippercent", "own", "ownpct"].includes(k))
    return "ownership_pct";
  if (["invested", "investedamount", "investment", "amount"].includes(k)) return "invested";
  return k;
}

export function parseHoldingsCsv(text: string): ParsedHoldingRow[] {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map(canonicalHeader);
  const idx = (key: string) => headers.indexOf(key);
  const hHolder = idx("holder");
  const hClass = idx("class");
  const hUnits = idx("units");
  const hPct = idx("ownership_pct");
  const hInvested = idx("invested");

  const rows: ParsedHoldingRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const holder = (hHolder >= 0 ? cells[hHolder] : cells[0] ?? "").trim();
    if (!holder) continue;
    rows.push({
      holder,
      className: hClass >= 0 ? (cells[hClass] ?? "").trim() || null : null,
      units: hUnits >= 0 ? num(cells[hUnits]) : null,
      ownershipPct: hPct >= 0 ? num(cells[hPct]) : null,
      invested: hInvested >= 0 ? num(cells[hInvested]) : null,
    });
  }
  return rows;
}

// Build a filesystem-friendly filename stem from an entity name.
export function csvFilenameStem(entityName: string): string {
  const safe = entityName
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return safe || "entity";
}
