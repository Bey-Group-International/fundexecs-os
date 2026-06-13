import { createHmac, randomUUID } from 'crypto';

/* ============================================================================
 * lib/inbox/livekit.ts — LiveKit access-token minting for in-app calls (P4).
 *
 * A LiveKit access token is a standard HS256 JWT signed with the API secret,
 * carrying a VideoGrant under the `video` claim. We mint it directly (no SDK
 * dependency) so the foundation stays light and unit-testable. Everything is
 * env-guarded: with no LIVEKIT_API_KEY/SECRET/URL the feature is simply off and
 * `mintAccessToken` returns null, so nothing breaks when it isn't configured.
 *
 * Real-time media (the embedded LiveKit room client, egress + live
 * transcription that feeds the Meeting Copilot finalize loop) is the remaining
 * P4 slice; this module is the server-side token + config seam it builds on.
 * ========================================================================= */

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Whether LiveKit is configured for this environment. */
export function livekitConfigured(): boolean {
  return Boolean(
    process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.LIVEKIT_URL
  );
}

/** The LiveKit server URL the client connects to (wss://…), or null. */
export function livekitUrl(): string | null {
  return process.env.LIVEKIT_URL ?? null;
}

/** Generate a collision-resistant room name for a new call. */
export function newRoomName(): string {
  return `fx-${randomUUID()}`;
}

export interface MintTokenOptions {
  /** Stable participant identity (we use the user id). */
  identity: string;
  /** The room to join. */
  room: string;
  /** Display name shown to other participants. */
  name?: string;
  /** Token lifetime in seconds (default 1h). */
  ttlSeconds?: number;
  /** Whether the participant may publish audio/video (default true). */
  canPublish?: boolean;
}

/**
 * Mint a LiveKit access token (HS256 JWT) for one participant + room. Returns
 * null when LiveKit isn't configured, so callers degrade to a "set up LiveKit"
 * state instead of throwing.
 */
export function mintAccessToken(opts: MintTokenOptions): string | null {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  const now = Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? 3600;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    exp: now + ttl,
    nbf: now - 10,
    iat: now,
    iss: apiKey,
    sub: opts.identity,
    jti: opts.identity,
    name: opts.name,
    video: {
      room: opts.room,
      roomJoin: true,
      canPublish: opts.canPublish ?? true,
      canSubscribe: true
    }
  };

  const encoded = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = base64Url(createHmac('sha256', apiSecret).update(encoded).digest());
  return `${encoded}.${signature}`;
}
