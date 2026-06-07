import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { KnowledgeView } from '@/components/knowledge/KnowledgeView';

const ROUTE = '/knowledge';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Knowledge Base',
  description:
    'Query the 15-specialist team over your own documents and history — retrieval-augmented through Ask Earn.',
  openGraph: {
    title: 'Knowledge Base · FundExecs OS',
    description: 'Ask the fifteen-specialist desk, grounded in your own record.'
  }
};

/**
 * Knowledge Base — the entry surface for the 15-specialist RAG. The retrieval
 * surface itself is Ask Earn (`/ask-earn`); this landing introduces the
 * knowledge base, shows the desk that answers, and routes into the live
 * surface. Read-only, tokens-only — no loaders, no writes.
 */
export default function KnowledgePage() {
  return (
    <AuthedShell title="Knowledge Base" subtitle="Intelligence" redirectFrom={ROUTE}>
      <KnowledgeView />
    </AuthedShell>
  );
}
