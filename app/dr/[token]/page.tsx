import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { FileQuestion } from 'lucide-react';
import { PublicRoomView } from '@/components/dataroom/PublicRoomView';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { getPublicDataRoom } from '@/lib/dataroom/public';

export const metadata: Metadata = {
  title: 'Shared data room',
  description: 'A vetted data-room link shared via FundExecs OS.',
  robots: { index: false, follow: false }
};

/**
 * /dr/[token] — the public side of the Data Room's share links. Anonymous,
 * shell-free, and honest: the vetting gate logs a REAL `data_room_views` row
 * (the same rows the operator's access bench renders), and the room shows
 * the material the manager actually built — nothing else leaves the org.
 */
export default async function PublicDataRoomPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const room = await getPublicDataRoom(token);

  // This browser's prior verification for THIS link (set by the gate action).
  const store = await cookies();
  const cookieName = room ? store.get(`fx_dr_${room.linkId}`)?.value : undefined;
  const verifiedAs = cookieName ? decodeURIComponent(cookieName) : null;

  return (
    <div className="min-h-dvh bg-bg-0 text-fg-1">
      <header className="flex items-center gap-2.5 border-b border-hairline px-[clamp(16px,4vw,32px)] py-4">
        <EarnCoin size={26} />
        <span className="text-[14.5px] font-semibold tracking-[-0.02em]">
          FundExecs <span className="font-medium text-fg-4">OS</span>
        </span>
        <span className="ml-auto text-[11px] uppercase tracking-[0.1em] text-fg-5">
          Secure data room
        </span>
      </header>
      <main className="mx-auto w-full max-w-[640px] px-[clamp(16px,4vw,32px)] py-10">
        {room ? (
          <PublicRoomView
            token={token}
            label={room.label}
            vetting={room.vetting}
            expired={room.expired}
            firm={room.firm}
            viewerName={verifiedAs}
            material={room.material}
          />
        ) : (
          <Card className="p-8 text-center">
            <FileQuestion size={22} className="mx-auto text-fg-4" aria-hidden />
            <h1 className="mt-3 text-[16px] font-semibold text-fg-1">No room at this address</h1>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
              This link doesn&rsquo;t match an active data room. Check it against the one you were
              sent, or ask the manager for a fresh link.
            </p>
          </Card>
        )}
      </main>
    </div>
  );
}
