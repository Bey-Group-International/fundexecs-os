import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFundProfile } from '@/lib/queries/fund-profile';
import type {
  FundOverview,
  FundStatus,
  LpDocument,
  LpDocumentAccess,
  LpDocumentKind,
  LpUpdate,
  LpUpdateLifecycle
} from '@/lib/lp-room/types';

/**
 * lib/lp-room/public.ts — the read side of the public `/lp/[token]` route.
 *
 * External LPs are anonymous, so RLS (org-member scoped) can't serve them;
 * reads run through the service-role client, keyed strictly by the unguessable
 * link token. The link carries an access TIER (`prospect` | `committed`) which
 * the resolver translates into the set of document access levels that may
 * leave the org — `admin-only` is NEVER selectable, and the per-LP commitment
 * schedule never crosses this boundary (only fund-level aggregates do).
 *
 * Mirrors `lib/dataroom/public.ts`: only what the share page needs is returned,
 * and any infra failure degrades to "no room" so a public link never 500s.
 */

/** The two tiers a link can grant. Defaults to the most restrictive. */
export type LpRoomTier = 'prospect' | 'committed';

/** `data_room_links.material_kind` value that marks an LP-room link + its tier.
 *  Reusing the free-text `material_kind` column keeps this schema-free. */
const LP_ROOM_KIND_PREFIX = 'lp_room:';

export function lpRoomKind(tier: LpRoomTier): string {
  return `${LP_ROOM_KIND_PREFIX}${tier}`;
}

/** Parse a link's `material_kind` into a tier, or null when it isn't an
 *  LP-room link. Unknown tiers fall back to the most restrictive (`prospect`). */
export function lpRoomTierFromKind(kind: string | null): LpRoomTier | null {
  if (!kind || !kind.startsWith(LP_ROOM_KIND_PREFIX)) return null;
  const tier = kind.slice(LP_ROOM_KIND_PREFIX.length);
  return tier === 'committed' ? 'committed' : 'prospect';
}

/** The document access levels a tier is allowed to see. `committed` sees
 *  prospect + committed; `prospect` sees prospect only. `admin-only` is never
 *  included — fail closed by construction. */
export function tierAllowedAccessLevels(tier: LpRoomTier): LpDocumentAccess[] {
  return tier === 'committed' ? ['prospect', 'committed'] : ['prospect'];
}

const DOC_KINDS = new Set<LpDocumentKind>([
  'lpa',
  'side-letter',
  'subscription',
  'report',
  'k1',
  'capital-call',
  'distribution-notice',
  'memo',
  'other'
]);

const ACCESS_LEVELS = new Set<LpDocumentAccess>(['committed', 'prospect', 'admin-only']);
const UPDATE_LIFECYCLES = new Set<LpUpdateLifecycle>([
  'mandate',
  'source-raise',
  'analyze-package',
  'communicate-close',
  'reporting'
]);

function asDocKind(value: string | null): LpDocumentKind {
  return value && DOC_KINDS.has(value as LpDocumentKind) ? (value as LpDocumentKind) : 'other';
}

function asAccessLevel(value: string | null): LpDocumentAccess {
  return value && ACCESS_LEVELS.has(value as LpDocumentAccess)
    ? (value as LpDocumentAccess)
    : 'prospect';
}

function asLifecycle(value: string | null): LpUpdateLifecycle {
  return value && UPDATE_LIFECYCLES.has(value as LpUpdateLifecycle)
    ? (value as LpUpdateLifecycle)
    : 'reporting';
}

function money(amount: number, currency = 'USD'): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(amount);
}

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'On record';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateOnly(value: string | null): string {
  if (!value) return 'On record';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return formatDate(value);
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function fundStatus(target: number, committed: number): FundStatus {
  if (target > 0 && committed >= target) return 'closed';
  if (target > 0 && committed > 0) return 'in-market';
  return 'open';
}

/** A security-filtered subset of the LP Room for a tokenized external viewer.
 *  Deliberately omits the per-LP commitment schedule, the Q&A thread, and any
 *  admin-only document — only fund-level aggregates and tier-appropriate
 *  material leave the org. */
export interface PublicLpRoom {
  linkId: string;
  orgId: string;
  tier: LpRoomTier;
  label: string;
  expired: boolean;
  firm: string;
  fund: FundOverview;
  /** Tier-filtered, never includes admin-only docs. */
  documents: LpDocument[];
  updates: LpUpdate[];
}

/** Build the security-filtered LP-room view for an org + tier. Used by the
 *  public route after a token resolves, and by the authenticated in-app
 *  "LP preview" (which passes the tier directly). Runs on the service-role
 *  client so it works for anonymous callers; callers must establish the
 *  org/tier from a trusted source (a resolved token or a server-verified
 *  membership) — this function trusts its arguments. */
export async function getPublicLpRoom(
  orgId: string,
  tier: LpRoomTier
): Promise<{ fund: FundOverview; documents: LpDocument[]; updates: LpUpdate[] }> {
  const admin = createAdminClient();
  const allowed = tierAllowedAccessLevels(tier);

  const [fundProfile, stackResult, documentsResult, updatesResult, attachmentsResult] =
    await Promise.all([
      getFundProfile(orgId),
      admin.rpc('capital_stack_summary', { _org_id: orgId }),
      // Hard filter at the query layer: only tier-allowed access levels are
      // ever fetched. admin-only is structurally excluded — fail closed.
      admin
        .from('lp_room_documents')
        .select('id, name, kind, size_bytes, signed, access_level, uploaded_at')
        .eq('org_id', orgId)
        .in('access_level', allowed)
        .order('uploaded_at', { ascending: false }),
      admin
        .from('lp_room_updates')
        .select('id, title, body, lifecycle, author_name, author_role, posted_at')
        .eq('org_id', orgId)
        .order('posted_at', { ascending: false })
        .limit(50),
      admin
        .from('lp_room_update_attachments')
        .select('id, update_id, document_id, name')
        .eq('org_id', orgId)
    ]);

  const stackRows = stackResult.data;
  const stackRow = Array.isArray(stackRows) ? (stackRows[0] ?? null) : (stackRows ?? null);
  const documentRows = documentsResult.data ?? [];
  const updateRows = updatesResult.data ?? [];
  const attachmentRows = attachmentsResult.data ?? [];

  const currency = stackRow?.currency ?? 'USD';
  const target = Number(stackRow?.target_total ?? fundProfile.targetRaise ?? 0);
  const committed = Number(stackRow?.committed_total ?? 0) + Number(stackRow?.closed_total ?? 0);
  const called = Number(stackRow?.closed_total ?? 0);

  const focusStrategy = fundProfile.focusAreas.join(', ');
  const strategy = fundProfile.strategy ?? (focusStrategy || 'Strategy not set');
  const vintage = (() => {
    const years = updateRows
      .map((u) => {
        const d = new Date(u.posted_at);
        return Number.isNaN(d.getTime()) ? null : d.getFullYear();
      })
      .filter((y): y is number => y !== null);
    return years.length > 0 ? Math.min(...years) : new Date().getFullYear();
  })();

  const fund: FundOverview = {
    name: fundProfile.fundName,
    vintage,
    strategy,
    sizeTarget: target > 0 ? money(target, currency) : 'TBD',
    committed: money(committed, currency),
    called: money(called, currency),
    status: fundStatus(target, committed),
    oneLiner: fundProfile.thesis ?? undefined
  };

  // Defence in depth: re-filter after mapping in case a row's access_level
  // slipped past the query filter (e.g. an unexpected stored value).
  const documents: LpDocument[] = documentRows
    .map((doc) => ({
      id: doc.id,
      name: doc.name,
      kind: asDocKind(doc.kind),
      sizeMb: fileSize(Number(doc.size_bytes ?? 0)),
      uploadedAt: formatDate(doc.uploaded_at),
      signed: Boolean(doc.signed),
      accessLevel: asAccessLevel(doc.access_level)
    }))
    .filter((doc) => doc.accessLevel !== 'admin-only' && allowed.includes(doc.accessLevel));

  const attachmentsByUpdateId = new Map<
    string,
    { id: string; name: string; documentId?: string }[]
  >();
  // Only surface attachments whose target document is within the viewer's tier
  // — an attachment must never become a side-channel to an admin-only file.
  const allowedDocIds = new Set(documents.map((d) => d.id));
  for (const attachment of attachmentRows) {
    if (attachment.document_id && !allowedDocIds.has(attachment.document_id)) continue;
    if (!attachmentsByUpdateId.has(attachment.update_id)) {
      attachmentsByUpdateId.set(attachment.update_id, []);
    }
    attachmentsByUpdateId.get(attachment.update_id)!.push({
      id: attachment.id,
      name: attachment.name,
      documentId: attachment.document_id ?? undefined
    });
  }

  const updates: LpUpdate[] = updateRows.map((update) => ({
    id: update.id,
    postedAt: formatDate(update.posted_at),
    title: update.title,
    body: update.body,
    author: update.author_name,
    authorRole: update.author_role ?? undefined,
    lifecycle: asLifecycle(update.lifecycle),
    attachments: attachmentsByUpdateId.get(update.id) ?? []
  }));

  return { fund, documents, updates };
}

/** Resolve a share token to its tier-scoped room. Null when the token doesn't
 *  exist, isn't an LP-room link, or any infra failure occurs. */
export async function resolvePublicLpRoom(token: string): Promise<PublicLpRoom | null> {
  const clean = (token ?? '').trim();
  if (!clean || clean.length > 64) return null;

  try {
    const admin = createAdminClient();
    const { data: link } = await admin
      .from('data_room_links')
      .select('id, org_id, label, material_kind, expires_at')
      .eq('token', clean)
      .maybeSingle();
    if (!link) return null;

    const tier = lpRoomTierFromKind(link.material_kind);
    if (!tier) return null; // Not an LP-room link — fail closed.

    const expired = !!link.expires_at && Date.parse(link.expires_at) < Date.now();

    const { data: org } = await admin
      .from('organizations')
      .select('name')
      .eq('id', link.org_id)
      .maybeSingle();

    // Don't load (or leak) any org material once the link is dead.
    const room = expired
      ? { fund: emptyFund(org?.name), documents: [], updates: [] }
      : await getPublicLpRoom(link.org_id, tier);

    return {
      linkId: link.id,
      orgId: link.org_id,
      tier,
      label: link.label || 'LP Room',
      expired,
      firm: org?.name ?? 'The manager',
      fund: room.fund,
      documents: room.documents,
      updates: room.updates
    };
  } catch {
    return null;
  }
}

function emptyFund(name?: string | null): FundOverview {
  return {
    name: name ?? 'The fund',
    vintage: new Date().getFullYear(),
    strategy: '',
    sizeTarget: 'TBD',
    committed: 'TBD',
    called: 'TBD',
    status: 'open'
  };
}
