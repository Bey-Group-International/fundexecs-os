import { AuthedShell } from '@/components/shell/AuthedShell';
import { ComingSoonPage } from '@/components/shell/ComingSoonPage';
import { STUB_ROUTES } from '@/components/shell/stub-routes';

const ROUTE = '/ic-memos';
const stub = STUB_ROUTES[ROUTE];

export const dynamic = 'force-dynamic';

export const metadata = { title: stub.title };

export default function IcMemosStubPage() {
  return (
    <AuthedShell title={stub.title} subtitle={stub.area} redirectFrom={ROUTE}>
      <ComingSoonPage {...stub} />
    </AuthedShell>
  );
}
