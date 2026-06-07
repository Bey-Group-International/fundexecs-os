import { AuthedShell } from '@/components/shell/AuthedShell';
import { ComingSoonPage } from '@/components/shell/ComingSoonPage';
import { STUB_ROUTES } from '@/components/shell/stub-routes';
import { MaterialsPreview } from '@/components/materials/MaterialsPreview';

const ROUTE = '/materials';
const stub = STUB_ROUTES[ROUTE];

export const dynamic = 'force-dynamic';

export const metadata = { title: stub.title };

export default function MaterialsStubPage() {
  return (
    <AuthedShell title={stub.title} subtitle={stub.area} redirectFrom={ROUTE}>
      <ComingSoonPage {...stub} preview={<MaterialsPreview />} />
    </AuthedShell>
  );
}
