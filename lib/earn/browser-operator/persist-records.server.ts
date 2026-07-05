// lib/earn/browser-operator/persist-records.server.ts
//
// The ONLY place browser-operator data enters real system records, and only for
// fields the operator explicitly approved. Each approved `ExtractedDataPoint` is
// routed by its field-name to the right home:
//
//   • person_*   → a professional network contact (via addProfessionalContact).
//   • filing_*   → an `edgar_filing_records` row.
//   • everything else (company_*, contact_*, …) → one `diligence_reports` row.
//
// No external action, send, or dispatch happens here — this is internal record
// creation on approval, nothing more.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { ExtractedDataPoint } from "./types";
import { addProfessionalContact } from "@/lib/integrations/professional-network/pipeline.server";
import { normalizeProfile } from "@/lib/integrations/professional-network/normalize-profile";

type Client = SupabaseClient<Database>;

export interface PersistContext {
  orgId: string;
  userId: string;
  sessionId: string;
  /** Fallback subject for a diligence report when no company name is present. */
  fallbackSubject: string;
}

export interface PersistResult {
  contactsCreated: number;
  filingsCreated: number;
  reportsCreated: number;
  errors: string[];
}

function classify(fieldName: string): "person" | "filing" | "company" {
  if (fieldName.startsWith("person_")) return "person";
  if (fieldName.startsWith("filing_")) return "filing";
  return "company";
}

/** Split a "Full Name — Title" hint into name + title parts. */
function splitPersonHint(value: string): { fullName: string; title: string | null } {
  const parts = value.split(/\s+[—–-]\s+/);
  if (parts.length >= 2) {
    return { fullName: parts[0].trim(), title: parts.slice(1).join(" - ").trim() || null };
  }
  // No delimiter — treat the leading capitalized run as the name.
  const nameMatch = value.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,2})/);
  return { fullName: (nameMatch?.[1] ?? value).trim(), title: null };
}

/**
 * Persist the operator-approved subset of extracted points into real records.
 * Best-effort per field: one failure is collected, not fatal to the rest.
 */
export async function persistApprovedRecords(
  supabase: Client,
  approved: ExtractedDataPoint[],
  ctx: PersistContext,
): Promise<PersistResult> {
  const result: PersistResult = { contactsCreated: 0, filingsCreated: 0, reportsCreated: 0, errors: [] };

  const companyNamePoint = approved.find((p) => p.field_name === "company_name");
  const cikPoint = approved.find((p) => p.field_name === "company_cik");
  const companyName = companyNamePoint?.extracted_value ?? ctx.fallbackSubject;

  const people = approved.filter((p) => classify(p.field_name) === "person");
  const filings = approved.filter((p) => classify(p.field_name) === "filing");
  const companyFields = approved.filter((p) => classify(p.field_name) === "company");

  // 1. People → professional network contacts.
  for (const p of people) {
    const { fullName, title } = splitPersonHint(p.extracted_value);
    const profile = normalizeProfile(
      { fullName, title: title ?? undefined, company: companyName, websiteUrl: p.source_url },
      "public_web",
    );
    if ("error" in profile) {
      result.errors.push(`person "${p.extracted_value}": ${profile.error}`);
      continue;
    }
    const added = await addProfessionalContact(supabase, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      profile,
    });
    if (added.ok) result.contactsCreated += 1;
    else if (!added.needsReview) result.errors.push(`contact insert: ${added.error}`);
    else result.errors.push(`contact "${fullName}" skipped — possible duplicate, needs manual review.`);
  }

  // 2. Filings → edgar_filing_records.
  for (const f of filings) {
    const [form, filingDate, accession] = f.extracted_value.split("·").map((s) => s.trim());
    const { error } = await supabase.from("edgar_filing_records").insert({
      organization_id: ctx.orgId,
      session_id: ctx.sessionId,
      created_by: ctx.userId,
      company_name: companyName,
      cik: cikPoint?.extracted_value ?? null,
      form: form || null,
      filing_date: filingDate || null,
      accession_number: accession || null,
      primary_doc_url: f.source_url ?? null,
      source_url: f.source_url ?? null,
      filed_summary: f.evidence_snippet ?? null,
    });
    if (error) result.errors.push(`filing "${f.extracted_value}": ${error.message}`);
    else result.filingsCreated += 1;
  }

  // 3. Remaining company/contact fields → one diligence report.
  if (companyFields.length > 0) {
    const data: Record<string, string> = {};
    for (const c of companyFields) data[c.field_name] = c.extracted_value;
    const sourceType = companyFields[0].source_type;
    const sourceUrl = companyFields.find((c) => c.source_url)?.source_url ?? null;
    const { error } = await supabase.from("diligence_reports").insert({
      organization_id: ctx.orgId,
      session_id: ctx.sessionId,
      created_by: ctx.userId,
      subject: companyName,
      source_type: sourceType,
      source_url: sourceUrl,
      summary: data.company_description ?? `Extracted profile for ${companyName}`,
      data: data as unknown as Json,
    });
    if (error) result.errors.push(`diligence report: ${error.message}`);
    else result.reportsCreated += 1;
  }

  return result;
}
