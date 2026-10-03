"use client";

import { MeetingGreenRoom } from "../[roomId]/MeetingGreenRoom";

const noop = () => {};

/**
 * The green room with no meeting behind it. Everything a meeting opens with —
 * preview, meter, device pickers, backgrounds, the fixes for a blocked camera —
 * so the first time somebody finds their microphone is muted is not in front
 * of the people they were meeting. A background chosen here is remembered for
 * the next call, the same as one chosen in a real green room.
 */
export function DeviceCheck() {
  return (
    <MeetingGreenRoom
      mode="check"
      roomCode=""
      isHost={false}
      joining={false}
      displayName=""
      onDisplayNameChange={noop}
      onJoin={noop}
    />
  );
}
