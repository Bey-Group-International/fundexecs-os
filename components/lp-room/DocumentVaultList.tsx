import {
  FileText,
  FileCheck2,
  FilePlus,
  FileSignature,
  FileBarChart,
  FileSpreadsheet,
  ShieldCheck,
  Download
} from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { LpDocument, LpDocumentAccess, LpDocumentKind } from './types';

const KIND_ICON: Record<LpDocumentKind, typeof FileText> = {
  lpa: FileSignature,
  'side-letter': FileSignature,
  subscription: FileCheck2,
  report: FileBarChart,
  k1: FileSpreadsheet,
  'capital-call': FilePlus,
  'distribution-notice': FilePlus,
  memo: FileText,
  other: FileText
};

const KIND_LABEL: Record<LpDocumentKind, string> = {
  lpa: 'LPA',
  'side-letter': 'Side letter',
  subscription: 'Subscription',
  report: 'Report',
  k1: 'K-1',
  'capital-call': 'Capital call',
  'distribution-notice': 'Distribution',
  memo: 'Memo',
  other: 'Document'
};

const ACCESS_TONE: Record<LpDocumentAccess, BadgeTone> = {
  committed: 'success',
  prospect: 'azure',
  'admin-only': 'warning'
};

const ACCESS_LABEL: Record<LpDocumentAccess, string> = {
  committed: 'Committed LPs',
  prospect: 'Prospect access',
  'admin-only': 'Admin only'
};

export interface DocumentVaultListProps {
  documents: LpDocument[];
  /** Click handler fired with the doc id — wired to a download / preview
   *  action by the backend later. */
  onOpen?: (documentId: string) => void;
  className?: string;
}

/**
 * DocumentVaultList — signed-and-stamped document index. Each row exposes
 * kind, signed/unsigned, access tier, size, and timestamp. Hover lifts the
 * row; the leading icon disc adopts a tone-matched border. Solid bg-bg-1
 * surfaces throughout (no translucent overlays).
 */
export function DocumentVaultList({ documents, onOpen, className }: DocumentVaultListProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="lp-document-vault">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle
          eyebrow="Vault · audit-ready"
          title="Every artifact, signed and timestamped"
        />
        <Badge tone="success" dot className="text-[10px]">
          SOC 2 · RLS
        </Badge>
      </div>
      {documents.length === 0 ? (
        <EmptyHint />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {documents.map((doc) => {
            const Icon = KIND_ICON[doc.kind];
            return (
              <li
                key={doc.id}
                data-testid={`lp-document-${doc.id}`}
                className="group flex items-center gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 transition-[background,transform,box-shadow] hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-sm)]"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 group-hover:text-fg-1">
                  <Icon size={15} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-semibold text-fg-1">{doc.name}</p>
                    {doc.signed ? (
                      <span
                        title="Signed artifact"
                        className="inline-flex items-center gap-0.5 rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] px-1.5 py-0.5 text-[9px] font-semibold text-success"
                      >
                        <ShieldCheck size={9} strokeWidth={2.2} aria-hidden />
                        Signed
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[10.5px] text-fg-4">
                    {KIND_LABEL[doc.kind]} · {doc.sizeMb} · {doc.uploadedAt}
                  </p>
                </div>
                <Badge tone={ACCESS_TONE[doc.accessLevel]} className="text-[10px]">
                  {ACCESS_LABEL[doc.accessLevel]}
                </Badge>
                <button
                  type="button"
                  onClick={() => onOpen?.(doc.id)}
                  aria-label={`Open ${doc.name}`}
                  data-testid={`lp-document-open-${doc.id}`}
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
                >
                  <Download size={13} strokeWidth={2} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function EmptyHint() {
  return (
    <div className="rounded-xl border border-dashed border-hairline bg-surface-1 p-6 text-center">
      <p className="text-[12.5px] font-medium text-fg-2">No artifacts in the Vault yet</p>
      <p className="mt-1 text-[11.5px] text-fg-4">
        Once Eleanor posts the LPA, side letters, and reports, every signed artifact lands here —
        audit-ready.
      </p>
    </div>
  );
}
