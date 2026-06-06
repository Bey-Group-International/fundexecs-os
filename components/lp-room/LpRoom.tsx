'use client';

import { useCallback } from 'react';
import { FundOverviewCard } from './FundOverviewCard';
import { DocumentVaultList } from './DocumentVaultList';
import { UpdateFeed } from './UpdateFeed';
import { CommitmentTracker } from './CommitmentTracker';
import { LpQAChat } from './LpQAChat';
import type { LpQuestionDraft, LpRoomData } from './types';

export interface LpRoomProps {
  data: LpRoomData;
  /** Click-through handler for a document in the Vault. Backend wires this
   *  later to the signed-URL download path. */
  onOpenDocument?: (documentId: string) => void;
  /** Q&A composer submit handler. Stays UI-only until Claude wires it. */
  onSubmitQuestion?: (draft: LpQuestionDraft) => void;
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
 * Backend wiring drops the `data` prop in for a real `LpRoomData` shape
 * and provides the two handlers. No state escapes the shell.
 */
export function LpRoom({ data, onOpenDocument, onSubmitQuestion }: LpRoomProps) {
  const handleOpenDocument = useCallback(
    (documentId: string) => onOpenDocument?.(documentId),
    [onOpenDocument]
  );
  const handleSubmitQuestion = useCallback(
    (draft: LpQuestionDraft) => onSubmitQuestion?.(draft),
    [onSubmitQuestion]
  );

  return (
    <div className="flex flex-col gap-[18px]" data-testid="lp-room">
      <FundOverviewCard fund={data.fund} />
      <CommitmentTracker snapshot={data.commitments} />
      <div className="grid gap-[18px] lg:grid-cols-[1.4fr_1fr]">
        <UpdateFeed updates={data.updates} />
        <DocumentVaultList documents={data.documents} onOpen={handleOpenDocument} />
      </div>
      <LpQAChat questions={data.questions} onSubmit={handleSubmitQuestion} />
    </div>
  );
}

export default LpRoom;
