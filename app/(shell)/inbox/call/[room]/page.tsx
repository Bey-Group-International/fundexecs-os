import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { CallRoom } from '@/components/inbox/CallRoom';
import { join_inbox_call } from '@/lib/actions/calls';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = { title: 'Call' };

/**
 * In-app call room (P4). Server-mints a LiveKit join token for the caller (the
 * RLS read inside `join_inbox_call` authorizes membership), then hands it to
 * the client surface. Degrades to a clear state when LiveKit isn't configured
 * or the caller can't access the room.
 */
export default async function CallPage({ params }: { params: Promise<{ room: string }> }) {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const { room } = await params;
  const res = await join_inbox_call(room);

  return (
    <div className="fx-rise mx-auto max-w-[760px]">
      <Link
        href="/inbox"
        className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-4 transition hover:text-fg-1"
      >
        <ArrowLeft size={14} strokeWidth={1.9} aria-hidden />
        Back to inbox
      </Link>

      {res.ok && res.token && res.url ? (
        <CallRoom room={room} token={res.token} url={res.url} />
      ) : (
        <Card className="p-8 text-center">
          <h1 className="text-[16px] font-semibold text-fg-1">
            {res.reason === 'not_configured'
              ? 'Calling isn’t set up yet'
              : res.reason === 'ended'
                ? 'This call has ended'
                : 'Call unavailable'}
          </h1>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            {res.reason === 'not_configured'
              ? 'In-app calls need LiveKit credentials (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL). Once set, rooms mint join tokens automatically.'
              : res.reason === 'ended'
                ? 'The room is closed. Its summary and findings live on the linked deal.'
                : (res.error ?? 'You don’t have access to this room.')}
          </p>
        </Card>
      )}
    </div>
  );
}
