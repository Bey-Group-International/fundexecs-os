'use client';
import { RouteError } from '@/components/shell/RouteError';
export default function CapTableError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} label="Cap Table" />;
}
