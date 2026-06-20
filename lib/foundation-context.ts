// lib/foundation-context.ts
// Gathers everything the firm has already entered across the Build modules
// (Profile/Brand, Thesis, Entities, Track Record, Team) into one compact,
// plain-text summary. Feeding this into a "Draft with Earn" prompt lets each
// module's Associate build on inputs from the other modules, so the foundation
// compounds instead of each draft starting from scratch. RLS-enforced reads via
// the request-scoped server client.
import { createServerClient } from "@/lib/supabase/server";
import { blendTrackRecord } from "@/lib/track-record";
import type {
  Organization,
  InvestmentThesis,
  Entity,
  TrackRecord,
  OrganizationMember,
  Principal,
} from "@/lib/supabase/database.types";

// Join a list of short, non-empty parts with a separator; "" when all missing.
function joinParts(parts: (string | null | undefined)[], sep: string): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join(sep);
}

/**
 * Build a compact, plain-text summary of what's already known about the firm
 * across all Build modules. Returns "" when essentially nothing is known.
 */
export async function gatherFoundationContext(orgId: string): Promise<string> {
  const supabase = createServerClient();

  const [orgRes, thesesRes, recordsRes, entitiesRes, membersRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase.from("investment_theses").select("*").eq("organization_id", orgId),
    supabase.from("track_records").select("*").eq("organization_id", orgId),
    supabase.from("entities").select("*").eq("organization_id", orgId),
    supabase.from("organization_members").select("*").eq("organization_id", orgId),
  ]);

  const org = (orgRes.data ?? null) as Organization | null;
  const theses = (thesesRes.data ?? []) as InvestmentThesis[];
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const members = (membersRes.data ?? []) as OrganizationMember[];

  // Resolve member names/titles for the Team line (best-effort; failure → none).
  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }

  const lines: string[] = [];

  // Firm: name (type, jurisdiction) — tagline
  if (org?.name) {
    const meta = joinParts([org.entity_type, org.jurisdiction], ", ");
    let firm = `Firm: ${org.name}`;
    if (meta) firm += ` (${meta})`;
    if (org.tagline) firm += ` — ${org.tagline}`;
    lines.push(firm);
    if (org.description) lines.push(`About: ${org.description}`);
    if (org.brand_voice) lines.push(`Brand voice: ${org.brand_voice}`);
  }

  // Thesis: active one, else most recent.
  const thesis = theses.find((t) => t.is_active) ?? theses[0] ?? null;
  if (thesis) {
    const bits: string[] = [];
    if (thesis.asset_classes?.length) bits.push(`asset classes: ${thesis.asset_classes.join(", ")}`);
    if (thesis.geographies?.length) bits.push(`geographies: ${thesis.geographies.join(", ")}`);
    const targets = joinParts(
      [
        thesis.target_irr != null ? `${thesis.target_irr}% IRR` : null,
        thesis.target_moic != null ? `${thesis.target_moic}x MOIC` : null,
      ],
      " / ",
    );
    if (targets) bits.push(`targets: ${targets}`);
    let line = `Thesis: ${thesis.title}`;
    if (bits.length) line += ` — ${bits.join("; ")}`;
    lines.push(line);
  }

  // Track record: pooled metrics via blendTrackRecord.
  if (records.length) {
    const blended = blendTrackRecord(records);
    const bits: string[] = [`${blended.dealCount} deals`, `${blended.realizedCount} realized`];
    if (blended.pooledMoic != null) bits.push(`pooled MOIC ${blended.pooledMoic.toFixed(2)}x`);
    if (blended.weightedGrossIrr != null)
      bits.push(`weighted gross IRR ${blended.weightedGrossIrr.toFixed(1)}%`);
    if (blended.vintageRange)
      bits.push(`vintages ${blended.vintageRange.from}–${blended.vintageRange.to}`);
    lines.push(`Track record: ${bits.join(", ")}`);
  }

  // Entities: name (type) list.
  if (entities.length) {
    const names = entities
      .map((e) => (e.entity_type ? `${e.name} (${e.entity_type})` : e.name))
      .join(", ");
    lines.push(`Entities: ${names}`);
  }

  // Team: name · title.
  if (principals.length) {
    const people = principals
      .map((p) => joinParts([p.full_name, p.title], " · "))
      .filter(Boolean)
      .join("; ");
    if (people) lines.push(`Team: ${people}`);
  }

  if (!lines.length) return "";

  // Keep it compact — cap at ~1200 chars so prompts stay focused.
  const summary = lines.join("\n");
  return summary.length > 1200 ? `${summary.slice(0, 1197)}...` : summary;
}
