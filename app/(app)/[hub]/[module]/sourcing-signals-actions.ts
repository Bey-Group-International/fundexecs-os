"use server";

import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import {
  generateSignals,
  recordSignals,
  listSignals,
  propensityScore,
  summarizeSignals,
  type EntitySignalInput,
  type SignalRecord,
  type SignalType,
  type Propensity,
} from "@/lib/sourcing-signals";
import type { EntityKind } from "@/lib/sourcing-intel";
import { ingestEntities } from "@/lib/sourcing-intel";
import { enrichFromWeb } from "@/lib/ingestion/enrich";

// A subject the signal feed groups around: an entity (or bare subject) with its
// signals + the derived propensity read.
export interface SubjectSignals {
  entityId: string | null;
  subjectName: string;
  kind: string | null;
  signals: SignalRecord[];
  propensity: Propensity;
  summary: string;
}

function groupBySubject(signals: SignalRecord[]): SubjectSignals[] {
  const groups = new Map<string, SubjectSignals>();
  for (const s of signals) {
    const key = s.entityId ?? `name:${s.subjectName.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        entityId: s.entityId,
        subjectName: s.subjectName,
        kind: s.kind,
        signals: [],
        propensity: { sell: 0, raise: 0 },
        summary: "",
      };
      groups.set(key, g);
    }
    g.signals.push(s);
  }
  for (const g of groups.values()) {
    g.propensity = propensityScore({ kind: g.kind }, g.signals);
    g.summary = summarizeSignals(g.signals);
  }
  // Hottest subjects first (max of the two propensity dials).
  return [...groups.values()].sort(
    (a, b) =>
      Math.max(b.propensity.sell, b.propensity.raise) -
      Math.max(a.propensity.sell, a.propensity.raise),
  );
}

export interface ScanResult {
  ok: boolean;
  subject?: SubjectSignals;
  /** How many fresh signals this scan recorded. */
  recorded?: number;
  error?: string;
}

// Scan an entity for fresh signals: generate (Claude-optional, deterministic
// fallback), record them best-effort, then return the entity's full signal set
// with its propensity read. With no entityId, picks the most recently added
// catalog entity to scan.
export async function scanSignals(entityId?: string): Promise<ScanResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const orgId = auth.ctx.orgId;
  const supabase = await createServerClient();

  // Resolve the entity to scan.
  let entity: { id: string; name: string; kind: string; description: string | null } | null = null;
  if (entityId) {
    const { data } = await supabase
      .from("sourcing_entities")
      .select("id, name, kind, description")
      .eq("organization_id", orgId)
      .eq("id", entityId)
      .maybeSingle();
    entity = data ?? null;
  } else {
    const { data } = await supabase
      .from("sourcing_entities")
      .select("id, name, kind, description")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    entity = data ?? null;
  }
  if (!entity) {
    return {
      ok: false,
      error: "No entity to scan — add one to the intelligence catalog first.",
    };
  }

  let recorded = 0;
  try {
    const generated: EntitySignalInput[] = await generateSignals({
      entityId: entity.id,
      name: entity.name,
      kind: entity.kind as EntityKind,
      description: entity.description,
    });
    recorded = await recordSignals(supabase, orgId, auth.ctx.userId, generated);
  } catch {
    // Generation/record is best-effort; we still return whatever is on file.
  }

  const all = await listSignals(supabase, orgId, { entityId: entity.id });
  const subject: SubjectSignals = {
    entityId: entity.id,
    subjectName: entity.name,
    kind: entity.kind,
    signals: all,
    propensity: propensityScore({ kind: entity.kind }, all),
    summary: summarizeSignals(all),
  };
  return { ok: true, subject, recorded };
}

export interface ListSignalsResult {
  ok: boolean;
  signals?: SignalRecord[];
  error?: string;
}

// List raw signals for one entity (or, with no entityId, the org-wide feed),
// optionally filtered by signal type.
export async function listEntitySignals(
  entityId?: string,
  signalType?: SignalType,
): Promise<ListSignalsResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const signals = await listSignals(supabase, auth.ctx.orgId, {
    entityId: entityId ?? null,
    signalType: signalType ?? null,
  });
  return { ok: true, signals };
}

export interface TopSignalsResult {
  ok: boolean;
  subjects?: SubjectSignals[];
  error?: string;
}

// The watchlist feed: the org's recent signals grouped by subject and ranked by
// propensity, so the hottest triggers surface first.
export async function topSignals(): Promise<TopSignalsResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const signals = await listSignals(supabase, auth.ctx.orgId, { limit: 120 });
  return { ok: true, subjects: groupBySubject(signals) };
}

// Enrich an entity from its own website: fetch the site once (compliant crawler),
// refresh the catalog record from what the page says (ingestion engine), and
// score the coverage tone into a `news` signal (sentiment engine). Unlike
// scanSignals (which synthesizes signals), this reads the REAL web. With no
// entityId, picks the most-recent catalog entity that has a domain on file.
export async function enrichEntityFromWeb(entityId?: string): Promise<ScanResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const orgId = auth.ctx.orgId;
  const supabase = await createServerClient();

  let query = supabase
    .from("sourcing_entities")
    .select("id, name, kind, domain")
    .eq("organization_id", orgId)
    .not("domain", "is", null);
  query = entityId ? query.eq("id", entityId) : query.order("created_at", { ascending: false });
  const { data } = await query.limit(1).maybeSingle();
  const entity = data ?? null;

  if (!entity) {
    return { ok: false, error: "No entity with a website on file — add a domain to enrich from the web." };
  }
  if (!entity.domain) {
    return { ok: false, error: `${entity.name} has no website on file — add a domain to enrich it.` };
  }

  const result = await enrichFromWeb({
    subjectName: entity.name,
    entityId: entity.id,
    kind: entity.kind as EntityKind,
    domain: entity.domain,
  });
  if (!result.ok) {
    const message =
      result.reason === "robots"
        ? `${entity.name}'s site disallows crawling (robots.txt).`
        : `Couldn't read ${entity.name}'s site right now.`;
    return { ok: false, error: message };
  }

  let recorded = 0;
  try {
    if (result.entity) await ingestEntities(supabase, orgId, auth.ctx.userId, [result.entity]);
    if (result.newsSignal) recorded = await recordSignals(supabase, orgId, auth.ctx.userId, [result.newsSignal]);
  } catch {
    // Persistence is best-effort; we still return the entity's current feed.
  }

  const all = await listSignals(supabase, orgId, { entityId: entity.id });
  const subject: SubjectSignals = {
    entityId: entity.id,
    subjectName: entity.name,
    kind: entity.kind,
    signals: all,
    propensity: propensityScore({ kind: entity.kind }, all),
    summary: summarizeSignals(all),
  };
  return { ok: true, subject, recorded };
}
