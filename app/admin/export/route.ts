import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/access.server';
import { getAccessApplicants } from '@/lib/queries/admin-access';

// Always run fresh — this is an export of live decision data.
export const dynamic = 'force-dynamic';

/** Escape a value for a single CSV cell (RFC 4180: quote, double inner quotes). */
function cell(value: string | null | undefined): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

const COLUMNS = [
  'name',
  'email',
  'company',
  'member_type',
  'mandate',
  'goal',
  'onboarding_complete',
  'access_status',
  'decided_at',
  'created_at'
] as const;

/**
 * GET /admin/export — download the full beta applicant list as CSV. Platform
 * admin (Bey Group) only; returns 403 for anyone else. Mirrors the inbox data
 * (`getAccessApplicants`), which is itself service-role + platform-gated.
 */
export async function GET() {
  if (!(await requirePlatformAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const applicants = await getAccessApplicants();

  const rows = applicants.map((a) =>
    [
      a.name,
      a.email,
      a.company,
      a.memberType,
      a.mandate,
      a.goal,
      a.onboardingComplete ? 'yes' : 'no',
      a.access,
      a.decidedAt,
      a.createdAt
    ]
      .map(cell)
      .join(',')
  );

  // Lead with a UTF-8 BOM so Excel opens accented names correctly.
  const csv = '﻿' + [COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="fundexecs-beta-applicants-${stamp}.csv"`,
      'Cache-Control': 'no-store'
    }
  });
}
