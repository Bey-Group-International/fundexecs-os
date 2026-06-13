import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/access.server';
import { getAccessAuditLog } from '@/lib/queries/admin-audit';

// Always run fresh — this is an export of live audit data.
export const dynamic = 'force-dynamic';

/**
 * Escape a value for a single CSV cell. RFC 4180 (quote, double inner quotes)
 * plus CSV-injection defense: a value that starts with a formula-trigger
 * character (= + - @, or a leading tab/CR) is prefixed with a single quote so
 * spreadsheet clients render it as text instead of executing it.
 */
function cell(value: string | null | undefined): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const COLUMNS = [
  'decided_at',
  'decision',
  'decided_by',
  'applicant_email',
  'applicant_user_id'
] as const;

/**
 * GET /admin/audit/export — download the beta access decision history as CSV
 * (who approved/declined whom, and when). Platform admin (Bey Group) only;
 * returns 403 for anyone else.
 */
export async function GET() {
  if (!(await requirePlatformAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const entries = await getAccessAuditLog();

  const rows = entries.map((e) =>
    [e.at, e.decision, e.actorEmail, e.targetEmail, e.targetUserId].map(cell).join(',')
  );

  // Lead with a UTF-8 BOM so Excel opens accented names correctly.
  const csv = '﻿' + [COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="fundexecs-access-audit-${stamp}.csv"`,
      'Cache-Control': 'no-store'
    }
  });
}
