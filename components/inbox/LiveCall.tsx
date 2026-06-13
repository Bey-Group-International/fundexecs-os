'use client';

import '@livekit/components-styles';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';

/* ============================================================================
 * components/inbox/LiveCall.tsx — embedded LiveKit room (P4 media slice).
 *
 * Browser-only: this is loaded via next/dynamic({ ssr: false }) from CallRoom,
 * so livekit-client's window/navigator access never runs on the server. The
 * server has already minted `token` for `serverUrl`; we connect, publish
 * mic/cam, and render LiveKit's prebuilt conference UI (grid + control bar).
 *
 * Scope (per product decision): real-time media + tokens only. No server-side
 * egress/recording — the transcript stays client-supplied in the wrap-up box,
 * which is why a transcription-consent banner sits above this in CallRoom.
 * ========================================================================= */

export default function LiveCall({
  token,
  serverUrl,
  onLeave
}: {
  token: string;
  serverUrl: string;
  onLeave: () => void;
}) {
  return (
    <div
      data-lk-theme="default"
      className="overflow-hidden rounded-xl border border-hairline"
      style={{ height: 'min(62vh, 560px)' }}
    >
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect
        video
        audio
        onDisconnected={onLeave}
        style={{ height: '100%' }}
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
