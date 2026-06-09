'use client';

import { useEffect } from 'react';
import { recordPostureSnapshot } from '@/lib/actions/strategy';

/**
 * Invisible recorder: writes today's Institutional Posture snapshot for the org
 * once the strategy page mounts. Kept out of the server render (DB writes don't
 * belong there); best-effort and no-ops before the Phase 3b migration is
 * applied. Renders nothing.
 */
export function PostureSnapshotRecorder({
  score,
  lanes,
  stage
}: {
  score: number;
  lanes: Record<string, number>;
  stage: string | null;
}) {
  useEffect(() => {
    void recordPostureSnapshot({ score, lanes, stage });
  }, [score, lanes, stage]);
  return null;
}
