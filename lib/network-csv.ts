// lib/network-csv.ts — CSV serialisation for the roster export.

import type { ActiveNetworkPerson } from "@/lib/network-active";

/**
 * Escape one CSV field.
 *
 * Beyond the usual quoting, a field whose first character is =, +, -, or @ is
 * prefixed with a single quote. Excel and Sheets treat such a value as a
 * FORMULA, so a contact whose name or note begins with one of those characters
 * becomes executable content in the recipient's spreadsheet. An exported
 * contact book is exactly the kind of file that gets mailed around, so the
 * prefix is not optional.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(",");
}

export const ROSTER_EXPORT_HEADERS = [
  "Name",
  "Type",
  "Title",
  "Company",
  "Email",
  "Stage",
  "Temperature",
  "Warmth",
  "Owner",
  "Capital role",
  "Tags",
  "Committed amount",
  "Last activity",
  "Days since contact",
  "Added",
  "Visibility",
] as const;

function isoDate(v: string | null): string {
  if (!v) return "";
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? "" : new Date(ms).toISOString().slice(0, 10);
}

export function rosterToCsv(people: ActiveNetworkPerson[]): string {
  const lines = [csvRow([...ROSTER_EXPORT_HEADERS])];
  for (const p of people) {
    lines.push(
      csvRow([
        p.name,
        p.kind,
        p.role,
        p.org,
        p.email,
        p.stage,
        p.temperature,
        p.warmth,
        p.ownerName,
        p.category,
        (p.tags ?? []).join("; "),
        p.committedAmount || "",
        isoDate(p.lastActivityAt ?? p.lastContactAt),
        p.lastContactDays ?? "",
        isoDate(p.addedAt),
        p.visibility,
      ]),
    );
  }
  // CRLF and a UTF-8 BOM: Excel misreads a plain UTF-8 CSV's accented names
  // otherwise, and an export nobody can open is not an export.
  return `﻿${lines.join("\r\n")}\r\n`;
}
