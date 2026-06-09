import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getFundProfile } from '@/lib/queries/fund-profile';
import type {
  CapitalAccountSummaryData,
  CommitmentScheduleRow,
  CommitmentSnapshot,
  DistributionItem,
  DistributionKind,
  DistributionStatus,
  FundOverview,
  FundStatus,
  LpAnswer,
  LpDocument,
  LpDocumentAccess,
  LpDocumentKind,
  LpQuestion,
  LpQuestionStatus,
  LpRoomData,
  LpUpdate,
  LpUpdateAttachment,
  LpUpdateLifecycle
} from '@/components/lp-room/types';
import type { Database, Json } from '@/lib/supabase/database.types';

type CapitalStackRow = Database['public']['Functions']['capital_stack_summary']['Returns'][number];
type DistributionRow = Database['public']['Tables']['distributions']['Row'];
type CapitalAccountRow = Database['public']['Tables']['capital_account_entries']['Row'];

type CapitalAccountEntryType =
  | 'commitment'
  | 'capital_call'
  | 'distribution'
  | 'nav_adjustment'
  | 'fee'
  | 'other';

interface CapitalAccountEntry {
  entryType: CapitalAccountEntryType;
  amount: number;
  balanceAfter: number | null;
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
const QUESTION_STATUSES = new Set<LpQuestionStatus>(['open', 'answered', 'archived']);
const DISTRIBUTION_KINDS = new Set<DistributionKind>([
  'return_of_capital',
  'profit',
  'dividend',
  'recallable',
  'special',
  'other'
]);
const DISTRIBUTION_STATUSES = new Set<DistributionStatus>(['pending', 'paid', 'cancelled']);

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

function asQuestionStatus(value: string | null): LpQuestionStatus {
  return value && QUESTION_STATUSES.has(value as LpQuestionStatus)
    ? (value as LpQuestionStatus)
    : 'open';
}

function asDistributionKind(value: string | null): DistributionKind {
  return value && DISTRIBUTION_KINDS.has(value as DistributionKind)
    ? (value as DistributionKind)
    : 'other';
}

function asDistributionStatus(value: string | null): DistributionStatus {
  return value && DISTRIBUTION_STATUSES.has(value as DistributionStatus)
    ? (value as DistributionStatus)
    : 'pending';
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

function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return 'On record';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {})
  });
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

function yearFrom(value: string | null | undefined): number | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-\d{2}-\d{2}$/.exec(value);
  if (dateOnly) return Number(dateOnly[1]);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear();
}

function earliestYear(values: Array<string | null | undefined>): number {
  const years = values
    .map(yearFrom)
    .filter((year): year is number => year !== null && Number.isFinite(year));
  return years.length > 0 ? Math.min(...years) : new Date().getFullYear();
}

function formatMonth(iso: string | null): string {
  if (!iso) return 'TBD';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return 'LP';
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
}

function asRecord(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringFrom(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function commitmentStatus(stage: string): CommitmentScheduleRow['status'] {
  const normalized = stage.toLowerCase();
  if (normalized === 'closed') return 'called';
  if (normalized === 'committed') return 'committed';
  if (normalized === 'withdrawn') return 'distributed';
  return 'in-progress';
}

function fundStatus(target: number, committed: number): FundStatus {
  if (target > 0 && committed >= target) return 'closed';
  if (target > 0 && committed > 0) return 'in-market';
  return 'open';
}

function mapCapitalAccountEntry(row: CapitalAccountRow): CapitalAccountEntry {
  return {
    entryType: row.entry_type as CapitalAccountEntryType,
    amount: Number(row.amount),
    balanceAfter: row.balance_after !== null ? Number(row.balance_after) : null
  };
}

function summariseCapitalAccount(entries: CapitalAccountEntry[]): CapitalAccountSummaryData {
  let committed = 0;
  let called = 0;
  let distributed = 0;
  const balanceSeries: number[] = [];
  let navBalance: number | null = null;

  for (const entry of entries) {
    if (entry.entryType === 'commitment') committed += entry.amount;
    if (entry.entryType === 'capital_call') called += Math.abs(entry.amount);
    if (entry.entryType === 'distribution') distributed += Math.abs(entry.amount);
    if (entry.balanceAfter !== null) {
      balanceSeries.push(entry.balanceAfter);
      navBalance = entry.balanceAfter;
    }
  }

  return { committed, called, distributed, navBalance, balanceSeries };
}

function requireRows<T>(
  result: { data: T[] | null; error: { message: string } | null },
  label: string
): T[] {
  if (result.error) throw new Error(`Failed to load ${label}: ${result.error.message}`);
  return result.data ?? [];
}

export async function getLpRoomData(orgId: string): Promise<LpRoomData> {
  const supabase = await createClient();

  const [
    fundProfile,
    stackResult,
    documentsResult,
    updatesResult,
    attachmentsResult,
    commitmentsResult,
    questionsResult,
    answersResult,
    citationsResult,
    distributionsResult,
    capitalAccountResult
  ] = await Promise.all([
    getFundProfile(orgId),
    supabase.rpc('capital_stack_summary', { _org_id: orgId }),
    supabase
      .from('lp_room_documents')
      .select('id, name, kind, size_bytes, signed, access_level, uploaded_at')
      .eq('org_id', orgId)
      .order('uploaded_at', { ascending: false }),
    supabase
      .from('lp_room_updates')
      .select('id, title, body, lifecycle, author_name, author_role, posted_at')
      .eq('org_id', orgId)
      .order('posted_at', { ascending: false })
      .limit(50),
    supabase
      .from('lp_room_update_attachments')
      .select('id, update_id, document_id, name')
      .eq('org_id', orgId),
    supabase
      .from('capital_commitments')
      .select('id, lp_id, amount, currency, stage, lp_type, expected_close, created_at')
      .eq('org_id', orgId)
      .neq('stage', 'withdrawn')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('lp_room_questions')
      .select('id, asker_name, body, status, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('lp_room_answers')
      .select('id, question_id, author_name, author_role, body, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
      .limit(200),
    supabase
      .from('lp_room_answer_citations')
      .select('id, answer_id, document_id, label')
      .eq('org_id', orgId)
      .limit(200),
    supabase
      .from('distributions')
      .select('*')
      .eq('org_id', orgId)
      .order('distribution_date', { ascending: false })
      .limit(200),
    supabase
      .from('capital_account_entries')
      .select('*')
      .eq('org_id', orgId)
      .order('entry_date', { ascending: true })
  ]);

  if (stackResult.error) {
    throw new Error(`Failed to load capital stack summary: ${stackResult.error.message}`);
  }

  const documentRows = requireRows(documentsResult, 'LP Room documents');
  const updateRows = requireRows(updatesResult, 'LP Room updates');
  const attachmentRows = requireRows(attachmentsResult, 'LP Room update attachments');
  const commitmentRows = requireRows(commitmentsResult, 'capital commitments');
  const questionRows = requireRows(questionsResult, 'LP Room questions');
  const answerRows = requireRows(answersResult, 'LP Room answers');
  const citationRows = requireRows(citationsResult, 'LP Room answer citations');
  const distributionRows = requireRows<DistributionRow>(distributionsResult, 'distributions');
  const capitalAccountRows = requireRows<CapitalAccountRow>(
    capitalAccountResult,
    'capital account entries'
  );

  const capitalAccount = summariseCapitalAccount(capitalAccountRows.map(mapCapitalAccountEntry));

  const stackRow: CapitalStackRow | null = Array.isArray(stackResult.data)
    ? (stackResult.data[0] ?? null)
    : (stackResult.data ?? null);

  const lpIds = Array.from(
    new Set(commitmentRows.map((row) => row.lp_id).filter((id): id is string => Boolean(id)))
  );
  const { data: providers } =
    lpIds.length > 0
      ? await supabase
          .from('capital_providers')
          .select('id, name, capital_types, criteria')
          .in('id', lpIds)
      : { data: [] };
  const providerById = new Map((providers ?? []).map((provider) => [provider.id, provider]));

  const currency = stackRow?.currency ?? commitmentRows[0]?.currency ?? 'USD';
  const target = Number(stackRow?.target_total ?? fundProfile.targetRaise ?? 0);
  const committed = Number(stackRow?.committed_total ?? 0) + Number(stackRow?.closed_total ?? 0);
  const called = Number(stackRow?.closed_total ?? 0);
  const distributed = capitalAccount.distributed;
  const remaining = Math.max(0, committed - called);

  const nextClose =
    commitmentRows
      .map((row) => row.expected_close)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;
  const focusStrategy = fundProfile.focusAreas.join(', ');
  const strategy = fundProfile.strategy ?? (focusStrategy || 'Strategy not set');
  const vintage = earliestYear([
    ...capitalAccountRows.map((row) => row.entry_date),
    ...commitmentRows.map((row) => row.created_at),
    ...distributionRows.map((row) => row.distribution_date),
    ...updateRows.map((row) => row.posted_at)
  ]);
  const dpi = called > 0 && distributed > 0 ? `${(distributed / called).toFixed(2)}x` : undefined;
  const tvpi =
    called > 0 && capitalAccount.navBalance !== null
      ? `${((capitalAccount.navBalance + distributed) / called).toFixed(2)}x`
      : undefined;

  const fund: FundOverview = {
    name: fundProfile.fundName,
    vintage,
    strategy,
    sizeTarget: target > 0 ? money(target, currency) : 'TBD',
    committed: money(committed, currency),
    called: money(called, currency),
    dpi,
    tvpi,
    irr: undefined,
    nextClose: nextClose ? formatDateOnly(nextClose) : undefined,
    status: fundStatus(target, committed),
    oneLiner: fundProfile.thesis ?? undefined
  };

  const documents: LpDocument[] = documentRows.map((doc) => ({
    id: doc.id,
    name: doc.name,
    kind: asDocKind(doc.kind),
    sizeMb: fileSize(Number(doc.size_bytes ?? 0)),
    uploadedAt: formatDate(doc.uploaded_at),
    signed: Boolean(doc.signed),
    accessLevel: asAccessLevel(doc.access_level)
  }));

  const attachmentsByUpdateId = new Map<string, LpUpdateAttachment[]>();
  for (const attachment of attachmentRows) {
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

  const schedule: CommitmentScheduleRow[] = commitmentRows.map((row) => {
    const provider = row.lp_id ? providerById.get(row.lp_id) : null;
    const providerName = provider?.name ?? 'LP on record';
    const criteria = asRecord(provider?.criteria);
    return {
      id: row.id,
      persona: row.lp_type ?? provider?.capital_types?.[0] ?? 'investor',
      initials: initials(providerName),
      city: stringFrom(criteria, 'city', 'location', 'geography', 'region') ?? 'On file',
      committed: money(Number(row.amount ?? 0), row.currency ?? currency),
      called:
        row.stage === 'closed' ? money(Number(row.amount ?? 0), row.currency ?? currency) : '$0',
      status: commitmentStatus(row.stage),
      when: formatMonth(row.expected_close ?? row.created_at)
    };
  });

  const commitments: CommitmentSnapshot = {
    committed: money(committed, currency),
    called: money(called, currency),
    distributed: money(distributed, currency),
    remaining: money(remaining, currency),
    schedule
  };

  const citationsByAnswerId = new Map<string, { id: string; label: string }[]>();
  for (const citation of citationRows) {
    if (!citationsByAnswerId.has(citation.answer_id)) {
      citationsByAnswerId.set(citation.answer_id, []);
    }
    citationsByAnswerId.get(citation.answer_id)!.push({
      id: citation.id,
      label: citation.label
    });
  }

  const answersByQuestionId = new Map<string, LpAnswer[]>();
  for (const answer of answerRows) {
    if (!answersByQuestionId.has(answer.question_id)) {
      answersByQuestionId.set(answer.question_id, []);
    }
    answersByQuestionId.get(answer.question_id)!.push({
      id: answer.id,
      author: answer.author_name,
      authorRole: answer.author_role ?? undefined,
      postedAt: formatDate(answer.created_at, true),
      body: answer.body,
      citations: citationsByAnswerId.get(answer.id) ?? []
    });
  }

  const questions: LpQuestion[] = questionRows.map((question) => ({
    id: question.id,
    askedBy: question.asker_name,
    askedAt: formatDate(question.created_at, true),
    body: question.body,
    status: asQuestionStatus(question.status),
    thread: answersByQuestionId.get(question.id) ?? []
  }));

  const distributions: DistributionItem[] = distributionRows.map((distribution) => ({
    id: distribution.id,
    distributionDate: formatDateOnly(distribution.distribution_date),
    kind: asDistributionKind(distribution.kind),
    amount: Number(distribution.amount),
    status: asDistributionStatus(distribution.status),
    memo: distribution.memo
  }));

  return {
    fund,
    documents,
    updates,
    commitments,
    questions,
    distributions,
    capitalAccount,
    isCapitalDataSample: false
  };
}
