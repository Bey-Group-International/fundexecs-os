'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  FileText,
  FileUp,
  Loader2,
  RefreshCw,
  Sparkles,
  TriangleAlert
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import {
  ingestDiligenceUpload,
  requestDiligenceUpload,
  runDiligenceForDeal
} from '@/lib/actions/diligence';
import type { DiligenceDocumentView } from '@/lib/queries/diligence';
import { cn } from '@/lib/utils';

/**
 * DiligenceDocumentsPanel — the run's evidence base, made real. Upload a
 * document → it lands in the diligence bucket via a signed URL → the ingest
 * pipeline extracts, chunks, and embeds it — and the next committee run
 * reads it. Three honest stages, shown as they happen.
 */

const KIND_OPTIONS = [
  { value: 'deck', label: 'Deck' },
  { value: 'cim', label: 'CIM' },
  { value: 'ppm', label: 'PPM' },
  { value: 'ddq', label: 'DDQ' },
  { value: 'financials', label: 'Financials' },
  { value: 'notes', label: 'Notes' },
  { value: 'other', label: 'Other' }
];

const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,application/pdf,text/plain';

type UploadStage = 'idle' | 'uploading' | 'indexing';

export function DiligenceDocumentsPanel({
  runId,
  dealId,
  dealName,
  documents
}: {
  runId: string;
  dealId: string | null;
  dealName: string | null;
  documents: DiligenceDocumentView[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('other');
  const [stage, setStage] = useState<UploadStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [justIndexed, setJustIndexed] = useState<string | null>(null);
  const [rerun, setRerun] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setJustIndexed(null);
    setStage('uploading');
    try {
      const minted = await requestDiligenceUpload({
        runId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        kind: kind as never
      });
      if (!minted.ok) {
        setError(minted.error);
        return;
      }

      const put = await fetch(minted.upload.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
      if (!put.ok) {
        setError('Upload failed — try again.');
        return;
      }

      setStage('indexing');
      const ingested = await ingestDiligenceUpload(minted.upload.documentId);
      if (!ingested.ok) {
        setError(ingested.error);
        return;
      }

      setJustIndexed(
        `${minted.upload.fileName} — indexed (${ingested.chunkCount} passage${
          ingested.chunkCount === 1 ? '' : 's'
        })`
      );
      router.refresh();
    } catch {
      setError('Upload failed — check your connection and try again.');
    } finally {
      setStage('idle');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const busy = stage !== 'idle';

  return (
    <Card className="p-[18px]">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
          <FileText size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Evidence base
          </div>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
            Documents the committee reads
          </div>
        </div>
        {dealId && documents.length > 0 && (
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => setRerun(true)}>
            Re-run review
          </Button>
        )}
      </div>

      {documents.length === 0 ? (
        <p className="mb-3 text-[12.5px] text-fg-4">
          No documents yet — this run was reviewed from the deal record alone. Upload the deck, the
          financials, the DDQ; the committee cites what it reads.
        </p>
      ) : (
        <div className="mb-3 flex flex-col gap-1.5">
          {documents.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-2.5"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                <FileText size={15} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-fg-1">{d.fileName}</div>
                <div className="text-[10.5px] text-fg-5">
                  {new Date(d.createdAt).toLocaleDateString()}
                </div>
              </div>
              <Badge tone="neutral" className="px-2 py-0.5 text-[9.5px] uppercase">
                {d.kind}
              </Badge>
              {d.chunkCount > 0 ? (
                <Badge tone="success" className="px-2 py-0.5 text-[9.5px]">
                  indexed · {d.chunkCount}
                </Badge>
              ) : (
                <Badge tone="warning" className="px-2 py-0.5 text-[9.5px]">
                  not indexed
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2.5 border-t border-hairline pt-3.5">
        <Select
          label="Document type"
          options={KIND_OPTIONS}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          disabled={busy}
          className="w-[150px] py-2 text-[12.5px]"
        />
        <label
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-hairline bg-surface-2 px-3.5 py-2 text-[12.5px] font-medium text-fg-1 transition hover:bg-surface-3',
            busy && 'pointer-events-none opacity-60'
          )}
        >
          {stage === 'uploading' ? (
            <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden />
          ) : stage === 'indexing' ? (
            <Sparkles size={14} className="text-gold-1" aria-hidden />
          ) : (
            <FileUp size={14} aria-hidden />
          )}
          {stage === 'uploading'
            ? 'Uploading…'
            : stage === 'indexing'
              ? 'Indexing — extracting & embedding…'
              : 'Upload a document'}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>
        <span className="text-[11px] text-fg-5">PDF, DOCX, PPTX, XLSX, TXT, MD or CSV.</span>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger"
        >
          <TriangleAlert size={15} aria-hidden />
          {error}
        </div>
      )}
      {justIndexed && !error && (
        <div
          role="status"
          className="mt-3 flex items-center gap-2.5 rounded-xl border border-[var(--success-line)] bg-[var(--success-soft)] px-3.5 py-2.5 text-[12.5px] text-success"
        >
          <CheckCircle2 size={15} aria-hidden />
          {justIndexed} — re-run the review to put it in front of the committee.
        </div>
      )}

      {rerun && dealId && (
        <ActionRunner
          title={`Re-run the review — ${dealName ?? 'this deal'}`}
          steps={[
            'Load the indexed evidence base',
            'Brief the six analysts',
            'Run the committee',
            'Prepare for your approval'
          ]}
          draftTitle={`Fresh committee review · ${dealName ?? 'deal'}`}
          draft={`A new 7-agent review of ${dealName ?? 'this deal'} over the current evidence base (${documents.length} document${documents.length === 1 ? '' : 's'}, ${documents.reduce((s, d) => s + d.chunkCount, 0)} indexed passages). Approving runs the committee now — analysts cite the documents directly, and the new verdict lands as its own run on the record.`}
          approveLabel="Approve & run"
          onApprove={async () => {
            const res = await runDiligenceForDeal(dealId);
            if (!res.ok) return { ok: false, error: res.error };
            router.push(`/run/diligence/${res.runId}`);
            return { ok: true };
          }}
          onClose={() => setRerun(false)}
          onApplied={() => router.refresh()}
        />
      )}
    </Card>
  );
}
