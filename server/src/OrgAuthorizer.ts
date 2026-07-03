// Room authorization for the SFU gateway. AuthService proves WHO the caller
// is (verified Supabase JWT); this proves WHERE they may go. Without it any
// authenticated user could join any roomId — and the shipped client connects
// everyone to the literal room "office-main", one shared space across every
// tenant on the deploy: cross-org presence, audio, and video.
//
// The fix is to make the room name an org-scoped namespace the SERVER derives,
// not a client-chosen string:
//   - a plain requested room ("office-main") resolves to
//     "org:<callerPrimaryOrg>:office-main", so each org gets its own office;
//   - an explicit "org:<uuid>:<room>" request is honored only when the caller
//     is a member of that org (supports future cross-room UIs);
//   - no memberships, unknown org, or malformed room → null → the gateway
//     rejects with 403. Fail closed, like the JWT check above it.
//
// Memberships are read via PostgREST with the service-role key and cached
// briefly per user so reconnect storms don't hammer the database.

interface CacheEntry {
  orgIds: string[];
  expiresAt: number;
}

// Plain room names stay a tight charset so junk input can't mint unbounded
// room keys or smuggle a namespace separator.
const PLAIN_ROOM = /^[A-Za-z0-9_-]{1,64}$/;
const ORG_ROOM = /^org:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([A-Za-z0-9_-]{1,64})$/i;

const MEMBERSHIP_TTL_MS = 60_000;

export class OrgAuthorizer {
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(supabaseUrl: string, serviceRoleKey: string, ttlMs: number = MEMBERSHIP_TTL_MS) {
    this.supabaseUrl = supabaseUrl.replace(/\/+$/, "");
    this.serviceRoleKey = serviceRoleKey;
    this.ttlMs = ttlMs;
  }

  configured(): boolean {
    return Boolean(this.supabaseUrl && this.serviceRoleKey);
  }

  /**
   * The caller's org ids, oldest membership first (so the "primary" org a
   * plain room resolves into is stable across calls). Cached per user for a
   * short TTL. Throws on transport/API failure — the gateway treats that as
   * "cannot authorize", not "authorized".
   */
  async getOrgIds(userId: string): Promise<string[]> {
    const now = Date.now();
    const hit = this.cache.get(userId);
    if (hit && hit.expiresAt > now) return hit.orgIds;

    const url =
      `${this.supabaseUrl}/rest/v1/organization_members` +
      `?principal_id=eq.${encodeURIComponent(userId)}` +
      `&select=organization_id&order=created_at.asc`;
    const response = await fetch(url, {
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
      },
    });
    if (!response.ok) {
      throw new Error(`membership lookup failed: ${response.status}`);
    }
    const rows = (await response.json()) as { organization_id?: unknown }[];
    const orgIds = rows
      .map((row) => row.organization_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    this.cache.set(userId, { orgIds, expiresAt: now + this.ttlMs });
    return orgIds;
  }

  /**
   * Resolve the room this user is allowed to join for a requested room id, or
   * null when the request must be refused. Never returns a room outside the
   * caller's org memberships.
   */
  async resolveRoom(userId: string, requestedRoomId: string): Promise<string | null> {
    if (!this.configured()) return null;

    const orgIds = await this.getOrgIds(userId);
    if (orgIds.length === 0) return null;

    const explicit = ORG_ROOM.exec(requestedRoomId);
    if (explicit) {
      const orgId = explicit[1].toLowerCase();
      return orgIds.some((id) => id.toLowerCase() === orgId) ? requestedRoomId : null;
    }

    if (!PLAIN_ROOM.test(requestedRoomId)) return null;
    return `org:${orgIds[0]}:${requestedRoomId}`;
  }
}
