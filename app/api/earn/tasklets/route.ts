import { NextResponse } from 'next/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getTaskletQueue } from '@/lib/tasklets/queries';
import type { Tasklet } from '@/lib/tasklets/types';

/**
 * GET /api/earn/tasklets — the operator's pending tasklet queue, refreshed from
 * live signals on read so the Earn dock can show approve-ready work the moment
 * it opens. Returns an empty list for signed-out / no-org users rather than
 * erroring, so the dock degrades cleanly.
 */
export async function GET() {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ tasklets: [] as Tasklet[] });
    const tasklets = await getTaskletQueue(org.orgId);
    return NextResponse.json({ tasklets });
  } catch {
    return NextResponse.json({ tasklets: [] as Tasklet[] });
  }
}
