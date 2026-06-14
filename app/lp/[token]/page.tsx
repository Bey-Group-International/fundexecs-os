import type { Metadata } from 'next';
import { FileQuestion } from 'lucide-react';
import { PublicLpRoom } from '@/components/lp-room/PublicLpRoom';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { resolvePublicLpRoom } from '@/lib/lp-room/public';

export const metadata: Metadata = {
  title: 'LP Room',
  description: 'A read-only LP Room shared via FundExecs OS.',
  robots: { index: false, follow: false }
};

/**
 * /lp/[token] — the public, read-only LP Room. Anonymous, shell-free, and
 * tier-scoped: the link's `material_kind` (`lp_room:<tier>`) decides which
 * documents may leave the org (prospect-only vs prospect+committed; never
 * admin-only), and the view shows fund-level aggregates only — never the
 * per-LP commitment schedule. Token resolution + signed-URL minting run
 * server-side through the service-role client, mirroring /dr/[token].
 */
export default async function PublicLpRoomPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const room = await resolvePublicLpRoom(token);

  return (
    <div className="min-h-dvh bg-bg-0 text-fg-1">
      <header className="flex items-center gap-2.5 border-b border-hairline px-[clamp(16px,4vw,32px)] py-4">
        <EarnCoin size={26} />
        <span className="text-[14.5px] font-semibold tracking-[-0.02em]">
          FundExecs <span className="font-medium text-fg-4">OS</span>
        </span>
        <span className="ml-auto text-[11px] uppercase tracking-[0.1em] text-fg-5">LP Room</span>
      </header>
      <main className="mx-auto w-full max-w-[680px] px-[clamp(16px,4vw,32px)] py-10">
        {room ? (
          <PublicLpRoom
            token={token}
            tier={room.tier}
            label={room.label}
            expired={room.expired}
            firm={room.firm}
            fund={room.fund}
            documents={room.documents}
            updates={room.updates}
          />
        ) : (
          <Card className="p-8 text-center">
            <FileQuestion size={22} className="mx-auto text-fg-4" aria-hidden />
            <h1 className="mt-3 text-[16px] font-semibold text-fg-1">No room at this address</h1>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
              This link doesn&rsquo;t match an active LP Room. Check it against the one you were
              sent, or ask the manager for a fresh link.
            </p>
          </Card>
        )}
      </main>
    </div>
  );
}
