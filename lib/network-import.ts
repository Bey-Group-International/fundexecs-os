// LinkedIn CSV import + Apollo enrichment pipeline.
// LinkedIn exports contacts as CSV with headers:
//   "First Name","Last Name","URL","Email Address","Company","Position","Connected On"

import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { enrichPerson } from "@/lib/integrations/providers/apollo";

export interface LinkedInRow {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  position: string;
  linkedinUrl: string;
  connectedOn: string | null;
}

// Parse LinkedIn CSV export into structured rows.
export function parseLinkedInCsv(csvText: string): LinkedInRow[] {
  const lines = csvText.split(/\r?\n/);
  // LinkedIn CSVs often start with a few note lines before the header.
  const headerIdx = lines.findIndex((l) =>
    l.toLowerCase().includes("first name") && l.toLowerCase().includes("last name"),
  );
  if (headerIdx === -1) return [];

  const headers = parseRow(lines[headerIdx]).map((h) => h.toLowerCase().trim());
  const col = (name: string) => headers.indexOf(name);

  const rows: LinkedInRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    if (cells.length < 3) continue;
    const firstName = cells[col("first name")] ?? "";
    const lastName = cells[col("last name")] ?? "";
    if (!firstName && !lastName) continue;
    rows.push({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: (cells[col("email address")] ?? "").trim(),
      company: (cells[col("company")] ?? "").trim(),
      position: (cells[col("position")] ?? "").trim(),
      linkedinUrl: (cells[col("url")] ?? "").trim(),
      connectedOn: (cells[col("connected on")] ?? "").trim() || null,
    });
  }
  return rows;
}

function parseRow(line: string): string[] {
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

// Insert parsed rows into network_contacts and return the job ID.
// New tables are not yet in database.types.ts so we cast to bypass strict typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (supabase: ReturnType<typeof createServerClient>) => supabase as any;

export async function importLinkedInContacts(
  csvText: string,
  pooled = true,
): Promise<{ jobId: string; total: number }> {
  const auth = await requireOrgContext();
  if (!auth.ok) throw new Error(auth.error);
  const { ctx } = auth;
  const supabase = createServerClient();
  const any = db(supabase);

  const rows = parseLinkedInCsv(csvText);
  if (rows.length === 0) throw new Error("No valid contacts found in CSV");

  // Create a job record.
  const { data: job } = await any
    .from("network_import_jobs")
    .insert({
      organization_id: ctx.orgId,
      created_by: ctx.userId,
      source: "linkedin_csv",
      status: "processing",
      total_rows: rows.length,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (!job) throw new Error("Failed to create import job");

  // Insert contacts in batches of 50.
  const BATCH = 50;
  let imported = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const records = batch.map((r) => ({
      organization_id: ctx.orgId,
      imported_by: ctx.userId,
      first_name: r.firstName,
      last_name: r.lastName,
      email: r.email || null,
      linkedin_url: r.linkedinUrl || null,
      title: r.position || null,
      company: r.company || null,
      connected_on: r.connectedOn || null,
      source: "linkedin_csv",
      pooled,
    }));
    await any.from("network_contacts").insert(records);
    imported += batch.length;
  }

  await any
    .from("network_import_jobs")
    .update({ status: "done", imported_rows: imported, completed_at: new Date().toISOString() })
    .eq("id", job.id);

  return { jobId: job.id, total: imported };
}

// Enrich a single contact via Apollo. Called lazily when a contact card is viewed.
export async function enrichContact(contactId: string): Promise<void> {
  const supabase = createServerClient();
  const any = db(supabase);

  const { data: contact } = await any
    .from("network_contacts")
    .select("email, linkedin_url, company")
    .eq("id", contactId)
    .single();
  if (!contact) return;

  // PersonEnrichParams only accepts email and linkedin_url.
  if (!contact.email && !contact.linkedin_url) return;

  const result = await enrichPerson({
    email: contact.email ?? undefined,
    linkedin_url: contact.linkedin_url ?? undefined,
  });

  // VerifiedResult uses status: 'success' | 'warning' | 'failed', not .success.
  if (result.status === "failed" || !result.data) return;
  const p = result.data;

  await any
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
