// lib/digest-prefs.ts
// Pure validation/normalization for the Act-now Radar digest delivery prefs
// (radar_digest_prefs, migration 0062). The Settings panel and its server
// action share this so the client and server agree on what a valid pref is:
// channel ∈ {in_app, slack, email}, cadence ∈ {daily, weekly}, min_score 0–100,
// and a recipient that is required for slack/email but meaningless for in_app
// (the in-app inbox is implicitly the org's own).

export const DIGEST_CHANNELS = ["in_app", "slack", "email"] as const;
export type DigestChannel = (typeof DIGEST_CHANNELS)[number];

export const DIGEST_CADENCES = ["daily", "weekly"] as const;
export type DigestCadence = (typeof DIGEST_CADENCES)[number];

export const MIN_SCORE_FLOOR = 0;
export const MIN_SCORE_CEILING = 100;

export function isDigestChannel(value: unknown): value is DigestChannel {
  return typeof value === "string" && (DIGEST_CHANNELS as readonly string[]).includes(value);
}

export function isDigestCadence(value: unknown): value is DigestCadence {
  return typeof value === "string" && (DIGEST_CADENCES as readonly string[]).includes(value);
}

// in_app lands in the org's own inbox, so it carries no external recipient.
export function recipientRequired(channel: DigestChannel): boolean {
  return channel === "slack" || channel === "email";
}

export type DigestPrefInput = {
  channel: unknown;
  recipient?: unknown;
  cadence?: unknown;
  min_score?: unknown;
  enabled?: unknown;
};

export type NormalizedDigestPref = {
  channel: DigestChannel;
  recipient: string | null;
  cadence: DigestCadence;
  min_score: number;
  enabled: boolean;
};

export type ValidationResult =
  | { ok: true; value: NormalizedDigestPref }
  | { ok: false; error: string };

// Coerce a possibly-string min_score into an integer clamped to [0, 100].
// Returns null when the input isn't a finite number so callers can reject it.
function parseMinScore(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(MIN_SCORE_CEILING, Math.max(MIN_SCORE_FLOOR, Math.round(n)));
}

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "on" || raw === "1") return true;
  if (raw === "false" || raw === "off" || raw === "0") return false;
  return fallback;
}

// Validate + normalize a single channel's digest preferences. Trims the
// recipient, requires it for slack/email, and forces it to null for in_app so a
// stale value never lingers. Defaults mirror the table: cadence 'daily',
// min_score 60, enabled true.
export function validateDigestPref(input: DigestPrefInput): ValidationResult {
  if (!isDigestChannel(input.channel)) {
    return { ok: false, error: "Unknown digest channel" };
  }
  const channel = input.channel;

  const cadenceRaw = input.cadence ?? "daily";
  if (!isDigestCadence(cadenceRaw)) {
    return { ok: false, error: "Cadence must be daily or weekly" };
  }
  const cadence = cadenceRaw;

  const min_score = input.min_score === undefined ? 60 : parseMinScore(input.min_score);
  if (min_score === null) {
    return { ok: false, error: "Min score must be a number between 0 and 100" };
  }

  const enabled = parseBool(input.enabled, true);

  let recipient: string | null = null;
  if (recipientRequired(channel)) {
    const trimmed = typeof input.recipient === "string" ? input.recipient.trim() : "";
    if (!trimmed) {
      return {
        ok: false,
        error: channel === "slack" ? "A Slack channel id is required" : "An email address is required",
      };
    }
    recipient = trimmed;
  }

  return { ok: true, value: { channel, recipient, cadence, min_score, enabled } };
}
