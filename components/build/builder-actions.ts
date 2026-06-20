"use server";

import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { gatherFoundationContext } from "@/lib/foundation-context";
import { composeDraft, type ComposeFoundation } from "@/lib/data-room-compose";
import { conversationalDraft, type DraftTurn } from "@/lib/claude";
import { blendTrackRecord } from "@/lib/track-record";
import type {
  Organization,
  InvestmentThesis,
  TrackRecord,
  Entity,
  OrganizationMember,
  Principal,
  Document,
} from "@/lib/supabase/database.types";

function compactUsd(n: number | null): string | null {
  if (n == null || n <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

async function loadFoundation(orgId: string): Promise<ComposeFoundation> {
  const supabase = createServerClient();
  const [orgRes, thesisRes, recordsRes, entitiesRes, membersRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase
      .from("investment_theses")
      .select("*")
      .eq("organization_id", orgId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("track_records").select("*").eq("organization_id", orgId),
    supabase.from("entities").select("*").eq("organization_id", orgId),
    supabase.from("organization_members").select("*").eq("organization_id", orgId),
  ]);
  const org = orgRes.data as Organization | null;
  const thesis = thesisRes.data as InvestmentThesis | null;
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const members = (membersRes.data ?? []) as OrganizationMember[];

  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase.from("principals").select("*").in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }
  const byId = new Map(principals.map((p) => [p.id, p]));
  const b = blendTrackRecord(records);

  return {
    orgName: org?.name ?? "Your Firm",
    tagline: org?.tagline ?? null,
    description: org?.description ?? null,
    entityType: org?.entity_type ?? null,
    jurisdiction: org?.jurisdiction ?? null,
    website: org?.website ?? null,
    thesisTitle: thesis?.title ?? null,
    thesisSummary: thesis?.summary ?? null,
    assetClasses: thesis?.asset_classes ?? [],
    geographies: thesis?.geographies ?? [],
    targetIrr: thesis?.target_irr ?? null,
    targetMoic: thesis?.target_moic ?? null,
    dealCount: b.dealCount,
    realizedCount: b.realizedCount,
    grossIrr: b.weightedGrossIrr != null ? Math.round(b.weightedGrossIrr) : null,
    pooledMoic: b.pooledMoic != null ? Math.round(b.pooledMoic * 10) / 10 : null,
    totalInvested: compactUsd(b.totalInvested),
    team: members.map((m) => {
      const p = byId.get(m.principal_id);
      return { name: p?.full_name || p?.email || "Member", title: p?.title ?? null };
    }),
    entities: entities.map((e) => e.name),
  };
}

// "Compose from your data" — deterministic first draft from the firm's Build
// foundation, tailored to the document's name/section.
export async function autoComposeContent(docId: string): Promise<{ content: string } | { error: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const supabase = createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("id", docId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const doc = data as Document | null;
  if (!doc) return { error: "Document not found" };
  const foundation = await loadFoundation(ctx.orgId);
  return { content: composeDraft(doc.name, doc.doc_type, foundation) };
}

// Earn (conversational) mode — drafts/revises the document via chat, grounded
// in the firm context. Returns Earn's reply and the full revised content.
export async function earnChat(
  docId: string,
  messages: DraftTurn[],
  currentContent: string,
): Promise<{ reply: string; content: string } | { error: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const supabase = createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("id", docId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const doc = data as Document | null;
  if (!doc) return { error: "Document not found" };
  const foundation = await gatherFoundationContext(ctx.orgId);
  return conversationalDraft({
    docName: doc.name,
    section: doc.doc_type ?? "other",
    currentContent,
    foundation,
    messages,
  });
}
