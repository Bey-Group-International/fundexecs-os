// Network contact import: LinkedIn CSV, person-list XLSX (family offices),
// and firm-list XLSX (seed funds / VC lists).
// Auto-detects format from headers; supports both person-level and firm-level rows.

import * as XLSX from "xlsx";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { enrichPerson } from "@/lib/integrations/providers/apollo";

export type ImportMode = "person" | "firm" | "auto";

export interface ParsedContact {
  firstName: string;
  lastName: string;
  email: string | null;
  company: string | null;
  title: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  connectedOn: string | null;
  source: "linkedin_csv" | "xlsx_person_list" | "xlsx_firm_list";
}

// ── Sanitization helpers ──────────────────────────────────────────────────────

function clean(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().replace(/^﻿/, ""); // strip BOM + whitespace
}

function cleanPhone(v: unknown): string | null {
  const s = clean(v).replace(/\s+/g, " ").trim();
  return s || null;
}

function cleanEmail(v: unknown): string | null {
  const s = clean(v).toLowerCase();
  if (!s || s.includes("redacted") || s.includes("protect") || !s.includes("@")) return null;
  return s;
}

function cleanUrl(v: unknown): string | null {
  const s = clean(v);
  return s.startsWith("http") ? s : null;
}

function normalizeDate(v: unknown): string | null {
  if (!v) return null;
  const s = clean(v);
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

// ── XLSX parsing ──────────────────────────────────────────────────────────────

const PERSON_SIGNALS = ["first name", "last name", "email", "linkedin", "job title", "company"];
const FIRM_SIGNALS = ["firm", "fund", "city", "stage", "seed", "venture"];

function findHeaderRow(rows: unknown[][]): { idx: number; headers: string[] } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map((c) => clean(c).toLowerCase());
    const hits = cells.filter((c) => [...PERSON_SIGNALS, ...FIRM_SIGNALS].some((s) => c.includes(s)));
    if (hits.length >= 2) return { idx: i, headers: cells };
  }
  return null;
}

function detectMode(headers: string[]): "person" | "firm" {
  const hasPerson = headers.some((h) => h.includes("first name") || h.includes("last name"));
  return hasPerson ? "person" : "firm";
}

function colIdx(headers: string[], ...names: string[]): number {
  for (const name of names) {
    const i = headers.findIndex((h) => h.includes(name));
    if (i !== -1) return i;
  }
  return -1;
}

export function parseXlsx(buffer: ArrayBuffer, modeHint: ImportMode = "auto"): ParsedContact[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const found = findHeaderRow(raw);
  if (!found) return [];

  const { idx: headerIdx, headers } = found;
  const mode = modeHint === "auto" ? detectMode(headers) : modeHint;
  const dataRows = raw.slice(headerIdx + 1);

  return mode === "firm" ? parseFirmRows(headers, dataRows) : parsePersonRows(headers, dataRows);
}

function parsePersonRows(headers: string[], rows: unknown[][]): ParsedContact[] {
  const iFirst = colIdx(headers, "first name");
  const iLast = colIdx(headers, "last name");
  const iEmail = colIdx(headers, "email");
  const iTitle = colIdx(headers, "job title", "position", "title");
  const iCompany = colIdx(headers, "company name", "company");
  const iLinkedin = colIdx(headers, "linkedin url", "linkedin");
  const iPhone = colIdx(headers, "phone number", "mobile phone", "phone");
  const iCity = colIdx(headers, "city");
  const iState = colIdx(headers, "state", "region");
  const iCountry = colIdx(headers, "country");
  const iConnected = colIdx(headers, "connected on");

  return rows
    .map((row): ParsedContact | null => {
      const firstName = clean(row[iFirst]);
      const lastName = clean(row[iLast]);
      if (!firstName && !lastName) return null;
      return {
        firstName, lastName,
        email: cleanEmail(row[iEmail]),
        company: clean(row[iCompany]) || null,
        title: clean(row[iTitle]) || null,
        linkedinUrl: cleanUrl(row[iLinkedin]),
        phone: cleanPhone(row[iPhone]),
        city: clean(row[iCity]) || null,
        state: clean(row[iState]) || null,
        country: clean(row[iCountry]) || null,
        connectedOn: normalizeDate(row[iConnected]),
        source: "xlsx_person_list",
      };
    })
    .filter((r): r is ParsedContact => r !== null);
}

function parseFirmRows(headers: string[], rows: unknown[][]): ParsedContact[] {
  const iFirm = colIdx(headers, "firm", "fund name", "company");
  const iCity = colIdx(headers, "city");
  const iState = colIdx(headers, "state");
  const iWebsite = colIdx(headers, "website", "url");

  return rows
    .map((row): ParsedContact | null => {
      const firm = clean(row[iFirm]);
      if (!firm || firm.length < 2) return null;
      return {
        firstName: firm,
        lastName: "",
        email: null,
        company: firm,
        title: "Fund / Firm",
        linkedinUrl: cleanUrl(row[iWebsite]),
        phone: null,
        city: clean(row[iCity]) || null,
        state: clean(row[iState]) || null,
        country: "United States",
        connectedOn: null,
        source: "xlsx_firm_list",
      };
    })
    .filter((r): r is ParsedContact => r !== null);
}

// ── LinkedIn CSV parsing ──────────────────────────────────────────────────────

export function parseLinkedInCsv(csvText: string): ParsedContact[] {
  const lines = csvText.split(/\r?\n/);
  const headerIdx = lines.findIndex(
    (l) => l.toLowerCase().includes("first name") && l.toLowerCase().includes("last name"),
  );
  if (headerIdx === -1) return [];

  const headers = parseCsvRow(lines[headerIdx]).map((h) => h.toLowerCase().trim());
  const col = (name: string) => headers.indexOf(name);

  return lines
    .slice(headerIdx + 1)
    .map((line): ParsedContact | null => {
      const cells = parseCsvRow(line);
      if (cells.length < 3) return null;
      const firstName = clean(cells[col("first name")]);
      const lastName = clean(cells[col("last name")]);
      if (!firstName && !lastName) return null;
      return {
        firstName, lastName,
        email: cleanEmail(cells[col("email address")]),
        company: clean(cells[col("company")]) || null,
        title: clean(cells[col("position")]) || null,
        linkedinUrl: cleanUrl(cells[col("url")]),
        phone: null, city: null, state: null, country: null,
        connectedOn: normalizeDate(cells[col("connected on")]),
        source: "linkedin_csv",
      };
    })
    .filter((r): r is ParsedContact => r !== null);
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

// ── DB insert ─────────────────────────────────────────────────────────────────

const anyDb = (supabase: ReturnType<typeof createServerClient>) => supabase as any;

export async function importContacts(
  contacts: ParsedContact[],
  pooled = true,
): Promise<{ jobId: string; total: number }> {
  const auth = await requireOrgContext();
  if (!auth.ok) throw new Error(auth.error);
  const { ctx } = auth;
  const supabase = createServerClient();
  const db = anyDb(supabase);

  if (contacts.length === 0) throw new Error("No valid contacts found");

  const source = contacts[0]?.source ?? "linkedin_csv";

  const { data: job } = await db
    .from("network_import_jobs")
    .insert({
      organization_id: ctx.orgId,
      created_by: ctx.userId,
      source,
      status: "processing",
      total_rows: contacts.length,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (!job) throw new Error("Failed to create import job");

  const BATCH = 50;
  let imported = 0;

  for (let i = 0; i < contacts.length; i += BATCH) {
    const batch = contacts.slice(i, i + BATCH);
    const records = batch.map((c) => ({
      organization_id: ctx.orgId,
      imported_by: ctx.userId,
      first_name: c.firstName,
      last_name: c.lastName || "",
      email: c.email,
      linkedin_url: c.linkedinUrl,
      phone: c.phone,
      title: c.title,
      company: c.company,
      location: [c.city, c.state, c.country].filter(Boolean).join(", ") || null,
      connected_on: c.connectedOn,
      source: c.source,
      pooled,
    }));

    await db.from("network_contacts").insert(records);
    imported += batch.length;
  }

  await db
    .from("network_import_jobs")
    .update({ status: "done", imported_rows: imported, completed_at: new Date().toISOString() })
    .eq("id", job.id);

  return { jobId: job.id, total: imported };
}

// Legacy shim for any callers using the old CSV-only API.
export async function importLinkedInContacts(
  csvText: string,
  pooled = true,
): Promise<{ jobId: string; total: number }> {
  return importContacts(parseLinkedInCsv(csvText), pooled);
}

// ── Apollo enrichment ─────────────────────────────────────────────────────────

export async function enrichContact(contactId: string): Promise<void> {
  const supabase = createServerClient();
  const db = anyDb(supabase);

  const { data: contact } = await db
    .from("network_contacts")
    .select("email, linkedin_url, company")
    .eq("id", contactId)
    .single();
  if (!contact) return;
  if (!contact.email && !contact.linkedin_url) return;

  const result = await enrichPerson({
    email: contact.email ?? undefined,
    linkedin_url: contact.linkedin_url ?? undefined,
  });

  if (result.status === "failed" || !result.data) return;
  const p = result.data;

  await db
    .from("network_contacts")
    .update({
      title: p.title ?? null,
      company: p.company ?? contact.company,
      location: p.location ?? null,
      phone: p.phone ?? null,
      confidence: Math.round((p.confidence ?? 0) * 100),
      verified: true,
      enriched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);
}
