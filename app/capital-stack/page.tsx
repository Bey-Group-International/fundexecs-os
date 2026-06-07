import { AuthedShell } from '@/components/shell/AuthedShell';
import { ComingSoonPage } from '@/components/shell/ComingSoonPage';
import { STUB_ROUTES } from '@/components/shell/stub-routes';
import { RaiseProgressBar } from '@/components/dashboard/RaiseProgressBar';
import { getActiveOrg } from '@/lib/queries/org';
import { getDashboardData } from '@/lib/queries/dashboard';

const ROUTE = '/capital-stack';
const stub = STUB_ROUTES[ROUTE];

export const dynamic = 'force-dynamic';

export const metadata = { title: stub.title };

/**
 * Capital Stack is still being built out as a full surface, but the raise-
 * progress roll-up (target / soft-circled / committed via `capital_stack_summary`
 * with an allocations fallback) already exists in the dashboard loader. We show
 * that real preview here so the stub reflects live numbers instead of pure
 * placeholder copy — no fabricated data; it degrades gracefully when no org.
 */
export default async function CapitalStackPage() {
  const org = await getActiveOrg().catch(() => null);
  const raiseProgress = org
    ? await getDashboardData(org.orgId)
        .then((d) => d.raiseProgress)
        .catch(() => null)
    : null;

  return (
    <AuthedShell title={stub.title} subtitle={stub.area} redirectFrom={ROUTE}>
      <ComingSoonPage
        {...stub}
        preview={raiseProgress ? <RaiseProgressBar progress={raiseProgress} /> : undefined}
      />
    </AuthedShell>
  );
}
