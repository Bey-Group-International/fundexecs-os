"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { getMandate } from "@/lib/build-readiness";
import { generateTargets, sourceConfigFor, type SourcingMandate } from "@/lib/source-ai";
import { buildOperatorContext } from "@/lib/source-intelligence";
import {
  semanticSearch,
  findSimilar,
  ingestEntities,
  entityKindForModule,
  type DiscoveryHit,
  type EntityKind,
  type IntelEntityInput,
} from "@/lib/sourcing-intel";
import { addSourcedTargets } from "@/app/(app)/[hub]/[module]/source-ai-actions";

// Catalog kind → the Source pipeline module its discoveries flow into.
function moduleForKind(kind: EntityKind): string {
  switch (kind) {
    case "investor":
    case "fund":
      return "source/lp_pipeline";
    case "company":
      return "source/deal_pipeline";
    case "lender":
      return "source/debt";
    case "advisor":
      return "source/partners";
    case "provider":
      return "source/providers";
    default:
      return "source/deal_pipeline";
  }
}

async function loadMandate(orgId: string): Promise<SourcingMandate | null> {
  const m = await getMandate(orgId);
  if (!m) return null;
  return {
    thesisTitle: m.thesisTitle,
    assetClasses: m.assetClasses,
    geographies: m.geographies,
    checkSizeMin: m.checkSizeMin,
    checkSizeMax: m.checkSizeMax,
    targetIrr: m.targetIrr,
    targetMoic: m.targetMoic,
  };
}

export interface DiscoverResult {
  ok: boolean;
  hits?: DiscoveryHit[];
  /** How many fresh entities this search added to the catalog. */
  discovered?: number;
  error?: string;
}

// The flagship: natural-language discovery. Optionally expand the catalog with
// fresh AI/web candidates for the query (personalized via the operator context +
// learning loop), then cosine-rank the whole catalog and return the best matches.
export async function discoverEntities(
  query: string,
  kind?: EntityKind | null,
  options: { expand?: boolean } = {},
): Promise<DiscoverResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const clean = String(query ?? "").trim().slice(0, 500);
  if (!clean) return { ok: false, error: "Describe what you're looking for." };

  const orgId = auth.ctx.orgId;
  const supabase = await createServerClient();

  let discovered = 0;
  // Expand: generate fresh candidates for the implied module and fold them into
  // the catalog so the "universe" grows with every search (zero-key fallback ok).
  if (options.expand !== false) {
    const moduleKey = moduleForKind(kind ?? "company");
    const cfg = sourceConfigFor(moduleKey);
    if (cfg) {
      const mandate = await loadMandate(orgId);
      const context = await buildOperatorContext(supabase, {
        orgId,
        principalId: auth.ctx.userId,
        role: auth.ctx.role,
        module: moduleKey,
      });
      try {
        const candidates = await generateTargets(moduleKey, mandate, [], clean, context);
        const entityKind = entityKindForModule(moduleKey);
        const inputs: IntelEntityInput[] = candidates.map((c) => ({
          kind: entityKind,
          name: c.name,
          description: c.rationale,
          categories: c.category ? [c.category] : [],
          metadata: { fitScore: c.fitScore, firstMove: c.firstMove, query: clean },
          provenance: c.sourceUrl ? "web" : "ai",
          sourceUrl: c.sourceUrl ?? null,
        }));
        discovered = await ingestEntities(supabase, orgId, auth.ctx.userId, inputs);
      } catch {
        // Discovery expansion is best-effort; search still runs on the catalog.
      }
    }
  }

  const hits = await semanticSearch(supabase, orgId, clean, { kind: kind ?? null, k: 12 });
  return { ok: true, hits, discovered };
}

export interface SimilarResult {
  ok: boolean;
  anchor?: string;
  hits?: DiscoveryHit[];
  error?: string;
}

// Lookalike search: find catalog entities most similar to a given one.
export async function findSimilarEntities(entityId: string): Promise<SimilarResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("sourcing_entities")
    .select("id, kind, name, categories, geography, description")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", entityId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Entity not found." };
  const hits = await findSimilar(supabase, auth.ctx.orgId, {
    id: data.id,
    name: data.name,
    categories: data.categories,
    geography: data.geography,
    description: data.description,
    kind: data.kind as EntityKind,
  });
  return { ok: true, anchor: data.name, hits };
}

export interface IndexResult {
  ok: boolean;
  indexed?: number;
  error?: string;
}

// Seed the catalog from the operator's live pipeline so discovery + lookalike
// have a base to reason over ("index my pipeline").
export async function indexPipeline(): Promise<IndexResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const orgId = auth.ctx.orgId;
  const supabase = await createServerClient();
  const modules = [
    "source/lp_pipeline",
    "source/deal_pipeline",
    "source/debt",
    "source/partners",
    "source/providers",
  ];
  let indexed = 0;
  for (const moduleKey of modules) {
    const cfg = sourceConfigFor(moduleKey);
    if (!cfg) continue;
    const { data } = await supabase
      .from(cfg.table as "investors")
      .select("*")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .limit(200);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    if (!rows.length) continue;
    const kind = entityKindForModule(moduleKey);
    const inputs: IntelEntityInput[] = rows.map((r) => {
      const category = r[cfg.categoryField];
      return {
        kind,
        name: String(r.name ?? "Unnamed"),
        description: typeof r.notes === "string" ? r.notes : null,
        categories: typeof category === "string" && category ? [category] : [],
        geography: typeof r.geography === "string" ? r.geography : typeof r.jurisdiction === "string" ? r.jurisdiction : null,
        metadata: { pipeline_id: String(r.id), stage: r[cfg.stageField] ?? null },
        provenance: "pipeline",
      };
    });
    indexed += await ingestEntities(supabase, orgId, auth.ctx.userId, inputs);
  }
  revalidatePath("/source/intel");
  return { ok: true, indexed };
}

export interface AddEntityResult {
  ok: boolean;
  added?: number;
  module?: string;
  error?: string;
}

// Promote a discovered catalog entity into the matching pipeline module — reuses
// the gated/learning-aware accept path (addSourcedTargets).
export async function addEntityToPipeline(entityId: string): Promise<AddEntityResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("sourcing_entities")
    .select("kind, name, categories, description, source_url, metadata")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", entityId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Entity not found." };

  const moduleKey = moduleForKind(data.kind as EntityKind);
  const shortModule = moduleKey.replace(/^source\//, "");
  const category = (data.categories ?? [])[0] ?? "";
  const res = await addSourcedTargets("source", shortModule, [
    {
      name: data.name,
      category,
      rationale: data.description ?? "",
      sourceUrl: data.source_url ?? undefined,
    },
  ]);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, added: res.added ?? 1, module: shortModule };
}
