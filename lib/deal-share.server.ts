// lib/deal-share.server.ts
// Sharing a deal across the ecosystem — the I/O orchestration. One call,
// `shareDeal`, does three things end to end: Earn drafts a confidential teaser
// memo, the deal is matched (AngelList-style, via lib/deal-share + lib/matching)
// to discoverable investors in OTHER orgs, and a tokenized public link is minted
// for tracked sending. Matched orgs get a push alert in their bell and a row in
// their "deals that fit you" pull feed.
//
// The owning-org writes (the share row) go through the request-bound client so
// RLS proves ownership; the cross-org reads and the recipient/alert writes go
// through the service role, which RLS rightly forbids the user. Matching + alert
// fan-out are never-block: a hiccup there must never fail the share itself.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic-client";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { computePriority } from "@/lib/inbox/intelligence";
import {
  rankInvestorMatchesForDeal,
  buildDealMemoFallback,
  buildDealAlertCopy,
  dealTeaser,
} from "@/lib/deal-share";
import type { Deal, Investor, Database, Json } from "@/lib/supabase/database.types";

type ThreadInsert = Database["public"]["Tables"]["inbox_threads"]["Insert"];
type RecipientInsert = Database["public"]["Tables"]["deal_share_recipients"]["Insert"];

export type ShareDealResult =
  | { ok: true; token: string; path: string; memo: string; matched: number; fits: number }
  | { ok: false; error: string };

// Bound the cross-org investor scan so a large ecosystem stays a couple of cheap
// queries; the matcher ranks in memory and only the top fits are surfaced.
const INVESTOR_SCAN_LIMIT = 1000;
const MATCH_MIN_SCORE = 50;
const MATCH_LIMIT = 8;

/** Earn's confidential teaser memo — Claude when configured, else deterministic. */
async function generateDealMemo(deal: Deal): Promise<string> {
  const fallback = buildDealMemoFallback(deal);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;
  try {
    const t = dealTeaser(deal);
    const anthropic = anthropicClient(apiKey);
    const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
    const message = await anthropic.messages.create(
      {
        model,
        max_tokens: 320,
        system:
          "You are Earn, the deal desk inside FundExecs OS. Write a 2-3 sentence CONFIDENTIAL deal teaser for investor outreach. Institutional, sentence case, no hype, no emoji. Use only the facts given — invent nothing, name no people, leak no contact details. Close by inviting a qualified investor to request the full deal room.",
        messages: [
          {
            role: "user",
            content:
              `Deal: ${t.name}\nStage: ${t.stage}\nSector: ${t.sector}\n` +
              `Geography: ${t.geography ?? "n/a"}\nTarget allocation: ${t.amount ?? "n/a"}\n\n` +
              `Write the teaser.`,
          },
        ],
      },
      { signal: AbortSignal.timeout(12_000) },
    );
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Match the deal to discoverable investors in other orgs and fan out the
 * recipient rows + bell alerts. Never-block: returns counts, swallows failures.
 */
async function matchAndNotify(
  deal: Deal,
  shareId: string,
  sharerOrgId: string,
  sharerName: string,
): Promise<{ matched: number; fits: number }> {
  const none = { matched: 0, fits: 0 };
  let admin: ReturnType<typeof createServiceClient>;
  try {
    admin = createServiceClient();
  } catch {
    return none; // no service role (preview/CI) — skip silently
  }

  // Discoverable orgs other than the sharer.
  const { data: orgRows } = await admin
    .from("organizations")
    .select("id")
    .eq("discoverable", true)
    .neq("id", sharerOrgId);
  const orgIds = (orgRows ?? []).map((o) => o.id);
  if (orgIds.length === 0) return none;

  // Their investor profiles.
  const { data: invRows } = await admin
    .from("investors")
    .select("*")
    .in("organization_id", orgIds)
    .is("archived_at", null)
    .limit(INVESTOR_SCAN_LIMIT);
  const investors = (invRows ?? []) as Investor[];
  if (investors.length === 0) return none;

  const matches = rankInvestorMatchesForDeal(deal, investors, {
    minScore: MATCH_MIN_SCORE,
    limit: MATCH_LIMIT,
  });
  if (matches.length === 0) return none;

  // One recipient row per matched investor (the feed shows which fit)...
  const recipients: RecipientInsert[] = matches.map((m) => ({
    share_id: shareId,
    organization_id: m.investor.organization_id,
    investor_id: m.investor.id,
    score: m.score,
    rationale: m.reasons as unknown as Json,
    source: "matched",
  }));
  await admin.from("deal_share_recipients").insert(recipients);

  // ...but one alert per org (its best-scoring match), so a firm with several
  // fitting LPs gets a single, high-signal bell — not a flood.
  const bestPerOrg = new Map<string, (typeof matches)[number]>();
  for (const m of matches) {
    const cur = bestPerOrg.get(m.investor.organization_id);
    if (!cur || m.score > cur.score) bestPerOrg.set(m.investor.organization_id, m);
  }

  const nowIso = new Date().toISOString();
  const threads: ThreadInsert[] = [...bestPerOrg.entries()].map(([orgId, m]) => {
    const copy = buildDealAlertCopy(deal, sharerName, m);
    return {
      organization_id: orgId,
      channel: "deal_share",
      category: "messaging",
      subject: copy.subject,
      counterparty_name: sharerName,
      counterparty_email: null,
      preview: copy.preview,
      status: "open",
      unread: true,
      priority: computePriority({
        category: "messaging",
        unread: true,
        hasContext: true,
        ageHours: 0,
        intent: copy.intent,
      }),
      intent: copy.intent,
      ai_summary: copy.aiSummary,
      last_message_at: nowIso,
      // The recipient's OWN investor profile the deal fit — resolves to their
      // /investor/<id> deep link. The deal itself stays in the sharer's org.
      investor_id: m.investor.id,
    };
  });
  await admin.from("inbox_threads").insert(threads);

  return { matched: bestPerOrg.size, fits: matches.length };
}

/**
 * Share a deal: draft the memo, mint the tracked link, and broadcast to matched
 * discoverable investors. Returns the public path + memo so the UI can show the
 * teaser and a copyable link. The matching half is never-block.
 */
export async function shareDeal(dealId: string): Promise<ShareDealResult> {
  if (!dealId) return { ok: false, error: "Missing deal." };
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authenticated." };

  const supabase = createServerClient();

  // Load the deal under RLS — only the owning org can share it.
  const { data: dealRow } = await supabase
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .maybeSingle();
  const deal = dealRow as Deal | null;
  if (!deal) return { ok: false, error: "Deal not found." };

  const memo = await generateDealMemo(deal);

  // Mint the share (token is DB-generated). Writer RLS gates this insert.
  const { data: shareRow, error: shareErr } = await supabase
    .from("deal_shares")
    .insert({
      organization_id: ctx.orgId,
      deal_id: deal.id,
      memo,
      created_by: ctx.userId,
    })
    .select("id, token")
    .single();
  if (shareErr || !shareRow) {
    return { ok: false, error: "Only a workspace member can share a deal." };
  }

  // Resolve the sharer's display name for the alert byline (best-effort).
  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", ctx.orgId)
    .maybeSingle();
  const sharerName = (org as { name: string } | null)?.name ?? "A FundExecs OS member";

  let matched = 0;
  let fits = 0;
  try {
    const result = await matchAndNotify(deal, shareRow.id, ctx.orgId, sharerName);
    matched = result.matched;
    fits = result.fits;
  } catch {
    // never-block — the share + link stand regardless of matchmaking
  }

  return { ok: true, token: shareRow.token, path: `/d/${shareRow.token}`, memo, matched, fits };
}

/** Revoke a share so its link stops resolving (owner/writer, RLS-gated). */
export async function revokeDealShare(shareId: string): Promise<{ ok: boolean }> {
  if (!shareId) return { ok: false };
  const supabase = createServerClient();
  const { error } = await supabase
    .from("deal_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", shareId)
    .is("revoked_at", null);
  return { ok: !error };
}

/**
 * Log a view of a tracked deal-share link. Runs under the service role from the
 * public page (no session), stamping the sharer's org so they read the access
 * log. Best-effort — a view-log failure never breaks the public page.
 */
export async function logDealShareView(
  token: string,
  viewer: { orgId?: string | null; label?: string | null } = {},
): Promise<void> {
  if (!token) return;
  try {
    const admin = createServiceClient();
    const { data: share } = await admin
      .from("deal_shares")
      .select("id, organization_id, revoked_at")
      .eq("token", token)
      .maybeSingle();
    if (!share || share.revoked_at) return;
    await admin.from("deal_share_views").insert({
      share_id: share.id,
      organization_id: share.organization_id,
      viewer_org_id: viewer.orgId ?? null,
      viewer_label: viewer.label ?? null,
    });
  } catch {
    // best-effort
  }
}

export interface DealFeedItem {
  recipientId: string;
  token: string;
  dealName: string;
  stage: string;
  sector: string;
  geography: string | null;
  amount: string | null;
  memo: string;
  score: number;
  sharedAt: string;
}

/**
 * The org's "deals that fit you" feed — deals shared by others that matched one
 * of this org's investor profiles. The recipient rows are read under RLS (proof
 * this org was matched); the share + deal teaser fields are then resolved with
 * the service role, since those rows live in the sharer's org. De-duped to one
 * entry per share, newest first.
 */
export async function getDealFeed(orgId: string): Promise<DealFeedItem[]> {
  if (!orgId) return [];
  const supabase = createServerClient();
  const { data: recRows } = await supabase
    .from("deal_share_recipients")
    .select("id, share_id, score, created_at")
    .eq("organization_id", orgId)
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  const recipients = (recRows ?? []) as Array<{
    id: string;
    share_id: string;
    score: number;
    created_at: string;
  }>;
  if (recipients.length === 0) return [];

  // Keep the strongest recipient row per share (already score-ordered).
  const bestByShare = new Map<string, (typeof recipients)[number]>();
  for (const r of recipients) if (!bestByShare.has(r.share_id)) bestByShare.set(r.share_id, r);
  const shareIds = [...bestByShare.keys()];

  let admin: ReturnType<typeof createServiceClient>;
  try {
    admin = createServiceClient();
  } catch {
    return [];
  }

  const { data: shareRows } = await admin
    .from("deal_shares")
    .select("id, token, memo, deal_id, revoked_at")
    .in("id", shareIds);
  const shares = (shareRows ?? []).filter((s) => !s.revoked_at) as Array<{
    id: string;
    token: string;
    memo: string;
    deal_id: string;
  }>;
  if (shares.length === 0) return [];

  const dealIds = [...new Set(shares.map((s) => s.deal_id))];
  const { data: dealRows } = await admin
    .from("deals")
    .select("id, name, stage, asset_class, geography, target_amount")
    .in("id", dealIds);
  const dealById = new Map((dealRows ?? []).map((d) => [d.id, d as Deal]));

  const items: DealFeedItem[] = [];
  for (const s of shares) {
    const deal = dealById.get(s.deal_id);
    if (!deal) continue;
    const rec = bestByShare.get(s.id)!;
    const t = dealTeaser(deal);
    items.push({
      recipientId: rec.id,
      token: s.token,
      dealName: t.name,
      stage: t.stage,
      sector: t.sector,
      geography: t.geography,
      amount: t.amount,
      memo: s.memo,
      score: rec.score,
      sharedAt: rec.created_at,
    });
  }
  return items.sort((a, b) => b.score - a.score);
}
