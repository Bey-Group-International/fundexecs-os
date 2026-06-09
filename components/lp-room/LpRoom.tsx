'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FundOverviewCard } from './FundOverviewCard';
import { DocumentVaultList } from './DocumentVaultList';
import { UpdateFeed } from './UpdateFeed';
import { CommitmentTracker } from './CommitmentTracker';
import { DistributionsFeed } from './DistributionsFeed';
import { CapitalAccountCard } from './CapitalAccountCard';
import { LpQAChat } from './LpQAChat';
import { openLpDocument, submitLpQuestion } from '@/lib/actions/lp-room';
import type { LpQuestionDraft, LpQuestionSubmitResult, LpRoomData } from './types';
import type { OpenLpDocumentResult } from '@/lib/actions/lp-room';

export interface LpRoomProps {
  data: LpRoomData;
  onOpenDocument?: (documentId: string) => Promise<OpenLpDocumentResult>;
  onSubmitQuestion?: (draft: LpQuestionDraft) => Promise<LpQuestionSubmitResult>;
}

/**
 * LpRoom — orchestrates the five LP Room surfaces:
 *
 *   1. FundOverviewCard       — hero with Eleanor's voice + six metrics
 *   2. CommitmentTracker      — capital snapshot + per-LP schedule
 *   3. UpdateFeed             — what changed, lifecycle-tagged
 *   4. DocumentVaultList      — signed artifact index
 *   5. LpQAChat               — threaded Q&A shell (composer fires onSubmit)
 *
 * The shell calls server actions for persisted Q&A and signed document access.
 */
export function LpRoom({ data, onOpenDocument, onSubmitQuestion }: LpRoomProps) {
  const router = useRouter();
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const openingRequestRef = useRef<string | null>(null);

  const handleOpenDocument = useCallback(
    async (documentId: string) => {
      openingRequestRef.current = documentId;
      setOpeningDocumentId(documentId);
      setDocumentError(null);
      try {
        const result = onOpenDocument
          ? await onOpenDocument(documentId)
          : await openLpDocument(documentId);
        if (!result.ok) {
          if (openingRequestRef.current === documentId) setDocumentError(result.error);
          return;
        }
        const opened = window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
        if (!opened) window.location.assign(result.signedUrl);
      } catch (err) {
        if (openingRequestRef.current === documentId) {
          setDocumentError(err instanceof Error ? err.message : 'Document could not be opened.');
        }
      } finally {
        if (openingRequestRef.current === documentId) {
          openingRequestRef.current = null;
          setOpeningDocumentId(null);
        }
      }
    },
    [onOpenDocument]
  );
  const handleSubmitQuestion = useCallback(
    async (draft: LpQuestionDraft) => {
      const result = onSubmitQuestion
        ? await onSubmitQuestion(draft)
        : await submitLpQuestion(draft);
      if (result.ok) router.refresh();
      return result;
    },
    [onSubmitQuestion, router]
  );

  return (
    <div className="flex flex-col gap-[18px]" data-testid="lp-room">
      <FundOverviewCard fund={data.fund} />
      <CapitalAccountCard summary={data.capitalAccount} isSample={data.isCapitalDataSample} />
      <CommitmentTracker snapshot={data.commitments} />
      {documentError ? (
        <p
          className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2 text-[12px] text-danger"
          role="alert"
        >
          {documentError}
        </p>
      ) : null}
      <div className="grid gap-[18px] lg:grid-cols-[1.4fr_1fr]">
        <UpdateFeed updates={data.updates} />
        <DocumentVaultList
          documents={data.documents}
          onOpen={handleOpenDocument}
          openingDocumentId={openingDocumentId}
        />
      </div>
      <DistributionsFeed distributions={data.distributions} isSample={data.isCapitalDataSample} />
      <LpQAChat questions={data.questions} onSubmit={handleSubmitQuestion} />
    </div>
  );
}

export default LpRoom;
