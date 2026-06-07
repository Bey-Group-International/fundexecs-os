'use client';
import { RouteError } from '@/components/shell/RouteError';
export default function ConnectionsError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} routeName="Connections" />;
}
