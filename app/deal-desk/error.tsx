'use client';

import { RouteError } from '@/components/shell/RouteError';

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError label="Deal Desk" error={error} reset={reset} />;
}
