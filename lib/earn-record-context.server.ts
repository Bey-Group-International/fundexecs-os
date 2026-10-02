// lib/earn-record-context.server.ts
//
// Loads the record an "Explain this" conversation is about and composes it into
// a prompt block for Earn's chat. Server-side and org-scoped on purpose: the
// browser sends only { type, id } (lib/earn-explain.ts), and the record detail
// reaches the model here without ever being returned to the client.
//
// Contacts go through loadContactRecord so a private relationship the caller
// can't see stays invisible — the same 404-equals-forbidden rule the contact
// page applies. Best-effort throughout: a miss returns null and the reply
// simply proceeds without the record.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDocumentText } from "@/lib/document-text.server";
import { loadContactRecord } from "@/lib/network-contact";
import type { Commitment, Database, Deal, DiligenceItem, Document, Investor } from "@/lib/supabase/database.types";
import type { ExplainRecordRef } from "@/lib/earn-explain";

const DOC_EXCERPT_CHARS = 12_000;
const NOTE_CHARS = 1_500;

export interface ExplainRecordContext {
  /** Display name of the record (deal name, investor, person, document). */
  name: string;
  /** Composed prompt block describing the record. */
  block: string;
}

function money(n: number | null | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

function clip(s: string | null | undefined, max = NOTE_CHARS): string | null {
  if (!s || !s.trim()) return null;
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function fields(pairs: [string, string | number | null | undefined][]): string {
  return pairs
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
}

async function dealContext(
  supabase: SupabaseClient<Database>,
  orgId: string,
  id: string,
): Promise<ExplainRecordContext | null> {
  const [dealRes, dilRes] = await Promise.all([
    supabase.from("deals").select("*").eq("id", id).eq("organization_id", orgId).maybeSingle(),
    supabase
      .from("diligence_items")
      .select("title, category, status, risk_severity, finding")
      .eq("organization_id", orgId)
      .eq("deal_id", id)
      .limit(25),
  ]);
  const deal = dealRes.data as Deal | null;
  if (!deal) return null;
  const items = (dilRes.data ?? []) as Pick<DiligenceItem, "title" | "category" | "status" | "risk_severity" | "finding">[];
  const dilLines = items.map(
    (d) =>
      `  - [${d.status}${d.risk_severity ? ` · ${d.risk_severity} risk` : ""}] ${d.category}: ${d.title}` +
      (d.finding ? ` — ${clip(d.finding, 200)}` : ""),
  );
  const block =
    `<deal name="${deal.name.replace(/"/g, "'")}">\n` +
    fields([
      ["Stage", deal.stage],
      ["Asset class", deal.asset_class],
      ["Geography", deal.geography],
      ["Target amount", money(deal.target_amount)],
      ["Thesis fit", deal.thesis_fit !== null ? `${deal.thesis_fit}/100` : null],
      ["Expected close", deal.expected_close],
      ["Source", deal.source],
      ["Website", deal.website],
    ]) +
    (clip(deal.notes) ? `\nNotes:\n${clip(deal.notes)}` : "") +
    (dilLines.length ? `\nDiligence items (${dilLines.length}):\n${dilLines.join("\n")}` : "\nNo diligence items yet.") +
    `\n</deal>`;
  return { name: deal.name, block };
}

async function investorContext(
  supabase: SupabaseClient<Database>,
  orgId: string,
  id: string,
): Promise<ExplainRecordContext | null> {
  const [invRes, comRes] = await Promise.all([
    supabase.from("investors").select("*").eq("id", id).eq("organization_id", orgId).maybeSingle(),
    supabase
      .from("commitments")
      .select("committed_amount, called_amount, distributed_amount, lifecycle_stage")
      .eq("organization_id", orgId)
      .eq("investor_id", id)
      .limit(20),
  ]);
  const inv = invRes.data as Investor | null;
  if (!inv) return null;
  const commitments = (comRes.data ?? []) as Pick<
    Commitment,
    "committed_amount" | "called_amount" | "distributed_amount" | "lifecycle_stage"
  >[];
  const committed = commitments.reduce((s, c) => s + (c.committed_amount ?? 0), 0);
  const block =
    `<investor name="${inv.name.replace(/"/g, "'")}">\n` +
    fields([
      ["Type", inv.investor_type],
      ["Pipeline stage", inv.pipeline_stage],
      ["Jurisdiction", inv.jurisdiction],
      ["AUM", money(inv.aum)],
      [
        "Typical check",
        inv.typical_check_min || inv.typical_check_max
          ? `${money(inv.typical_check_min) ?? "?"}–${money(inv.typical_check_max) ?? "?"}`
          : null,
      ],
      ["Sectors", inv.sectors?.length ? inv.sectors.join(", ") : null],
      ["Open to emerging managers", inv.open_to_emerging_managers === null || inv.open_to_emerging_managers === undefined ? null : inv.open_to_emerging_managers ? "yes" : "no"],
      ["Allocation signal", inv.allocation_signal],
      ["Primary contact", inv.contact_name ? `${inv.contact_name}${inv.role ? ` (${inv.role})` : ""}` : null],
      ["Website", inv.website],
      [
        "Commitments to the firm",
        commitments.length ? `${commitments.length} totalling ${money(committed)}` : "none recorded",
      ],
    ]) +
    (clip(inv.notes) ? `\nNotes:\n${clip(inv.notes)}` : "") +
    `\n</investor>`;
  return { name: inv.name, block };
}

async function contactContext(
  supabase: SupabaseClient<Database>,
  orgId: string,
  id: string,
): Promise<ExplainRecordContext | null> {
  // loadContactRecord applies the private-relationship visibility rule.
  const view = await loadContactRecord(supabase as unknown as SupabaseClient, orgId, id, { timelineLimit: 15 });
  if (!view) return null;
  const c = view.contact;
  const touches = view.timeline
    .slice(0, 15)
    .map(
      (t) =>
        `  - ${t.occurredAt.slice(0, 10)} ${t.type}${t.direction ? ` (${t.direction})` : ""}` +
        (t.subject ? `: ${clip(t.subject, 120)}` : ""),
    );
  const block =
    `<contact name="${c.fullName.replace(/"/g, "'")}">\n` +
    fields([
      ["Title", c.title],
      ["Company", c.company],
      ["Location", c.location],
      ["Capital role", c.capitalRole],
      ["Relationship type", c.relationshipType],
      ["Stage", c.stage],
      ["Relationship strength", `${c.strengthLabel} (${c.strengthScore})`],
      ["Owner", c.ownerName],
      ["Tags", c.tags.length ? c.tags.join(", ") : null],
      ["Last activity", c.lastActivityAt?.slice(0, 10)],
    ]) +
    (clip(c.notes) ? `\nNotes:\n${clip(c.notes)}` : "") +
    (touches.length ? `\nRecent activity:\n${touches.join("\n")}` : "\nNo recorded activity.") +
    `\n</contact>`;
  return { name: c.fullName, block };
}

async function documentContext(
  supabase: SupabaseClient<Database>,
  orgId: string,
  id: string,
): Promise<ExplainRecordContext | null> {
  const { data } = await supabase
    .from("documents")
    .select("id, name, doc_type, status, storage_key, content")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  const doc = data as Pick<Document, "id" | "name" | "doc_type" | "status" | "storage_key" | "content"> | null;
  if (!doc) return null;
  let text = "";
  if (doc.storage_key) {
    const t = await getDocumentText({ orgId, documentId: doc.id, storageKey: doc.storage_key });
    text = t?.status === "ok" ? t.text : "";
  } else {
    text = doc.content ?? "";
  }
  const cut = text.length > DOC_EXCERPT_CHARS;
  const block =
    `<document name="${doc.name.replace(/"/g, "'")}" type="${doc.doc_type ?? "other"}">\n` +
    (text.trim()
      ? `${text.slice(0, DOC_EXCERPT_CHARS)}${cut ? "\n[…truncated]" : ""}`
      : "[No readable text could be extracted from this document.]") +
    `\n</document>`;
  return { name: doc.name, block };
}

/** Load and compose the record an Explain conversation is about, or null. */
export async function loadExplainRecordContext(
  supabase: SupabaseClient<Database>,
  orgId: string,
  ref: ExplainRecordRef,
): Promise<ExplainRecordContext | null> {
  switch (ref.type) {
    case "deal":
      return dealContext(supabase, orgId, ref.id);
    case "investor":
      return investorContext(supabase, orgId, ref.id);
    case "contact":
      return contactContext(supabase, orgId, ref.id);
    case "document":
      return documentContext(supabase, orgId, ref.id);
  }
}
