// lib/meetings/connection-check.ts
// A quick read of the connection before joining: round trips to this app's own
// server, and what the browser says about the network, turned into one word and
// what to do about it.
//
// Pure: no DOM. The caller does the timing.

export type ConnectionQuality = "good" | "fair" | "poor" | "offline";

export interface ConnectionVerdict {
  quality: ConnectionQuality;
  label: string;
  /** What to do, when there is something to do. */
  advice: string | null;
}

/** The middle of the samples: one slow request is not a slow connection. */
export function medianMs(samples: readonly number[]): number | null {
  const ok = samples.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!ok.length) return null;
  const mid = Math.floor(ok.length / 2);
  return ok.length % 2 ? ok[mid] : Math.round((ok[mid - 1] + ok[mid]) / 2);
}

/**
 * The verdict from a median round trip (null when every request failed), the
 * browser's online flag, and its effective connection type when it offers one.
 */
export function connectionVerdict(rttMs: number | null, online: boolean, effectiveType?: string | null): ConnectionVerdict {
  if (!online || rttMs === null) {
    return {
      quality: "offline",
      label: "Offline",
      advice: "You're not connected. Check your Wi-Fi or network, then try again.",
    };
  }
  const slowType = effectiveType === "2g" || effectiveType === "slow-2g";
  if (rttMs > 600 || slowType) {
    return {
      quality: "poor",
      label: `Poor (${Math.round(rttMs)} ms)`,
      advice: "Video may freeze. Move closer to your router, close other downloads, or join with your camera off.",
    };
  }
  if (rttMs > 250 || effectiveType === "3g") {
    return {
      quality: "fair",
      label: `Fair (${Math.round(rttMs)} ms)`,
      advice: "Should work. If video stutters, turn your camera off.",
    };
  }
  return { quality: "good", label: `Good (${Math.round(rttMs)} ms)`, advice: null };
}
