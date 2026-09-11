// lib/meetings/turn-credentials.ts
// Reading the TURN credential out of the environment, and telling an operator
// when it is wrong in a way they can act on.
//
// Written after production told us, through the runtime log, that it had been
// answering `Metered returned 401` since 2 July. The route treated that as a
// transient hiccup and fell back to STUN, so the symptom reaching people was
// not "TURN is misconfigured" but "guests on some networks cannot connect" —
// the exact report that took three pull requests to chase, with the cause
// sitting in a log nobody reads.
//
// Three things here, and each is a different failure:
//
//   1. The key is not set at all. Nothing to fix in code; the deployment simply
//      has no TURN.
//   2. The key is set but DIRTY. Environment variables pasted into a dashboard
//      routinely carry a trailing newline or a pair of quotes the shell would
//      have stripped. That value then went into a URL query string unescaped,
//      so the request Metered received was not the key at all. This is the
//      likeliest explanation for a credential that was once right and now 401s,
//      and it is the one thing on the list that code can fix outright.
//   3. The key is set, clean, and REFUSED. Only a person with the Metered
//      account can fix that, so the job here is to say so unmistakably rather
//      than to retry a wrong answer every hour until someone reads a log.
//
// The distinction that matters is permanent versus transient. A 401 will still
// be a 401 in five minutes; a 503 will not. They are not worth the same
// response, and they were getting it.
//
// Pure: no fetch, no process, no cache. The route supplies the values.

/** What the TURN provider said, in terms of what should happen next. */
export type TurnStatus =
  /** Credentials came back. */
  | "ok"
  /** The provider refused the key. Retrying changes nothing; a person must. */
  | "rejected"
  /** The provider is having a bad time. Worth trying again later. */
  | "unavailable";

/** Why a response carries no relay, for the client to log and an operator to read. */
export type TurnUnavailableReason =
  /** No METERED_API_KEY in this environment — TURN was never configured. */
  | "unconfigured"
  /** The key is present and the provider rejected it. */
  | "rejected"
  /** The provider failed or could not be reached. */
  | "unavailable";

/** How long credentials are good for. Metered issues them for an hour. */
export const TURN_CREDENTIAL_TTL_MS = 59 * 60 * 1000;

/**
 * Clean a credential read from the environment.
 *
 * Trims, and strips one matching pair of surrounding quotes. Both come from the
 * same place: a value pasted into a dashboard field, or copied out of a `.env`
 * line where the quotes were the file format rather than part of the secret.
 * Neither survives being sent to a provider, and both produce a 401 that looks
 * exactly like a revoked key.
 *
 * Returns null rather than an empty string, so "set to nothing" and "not set"
 * are the same thing to the caller — which is what they mean.
 */
export function cleanCredential(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
    }
  }
  return value.length > 0 ? value : null;
}

/**
 * Whether the environment's raw value would have been sent as-is.
 *
 * Only for the log line: an operator who is told their key has a trailing
 * newline can fix it in ten seconds, and would otherwise spend the afternoon
 * regenerating a key that was never the problem.
 */
export function credentialWasDirty(raw: string | undefined | null): boolean {
  if (typeof raw !== "string") return false;
  const cleaned = cleanCredential(raw);
  return cleaned !== null && cleaned !== raw;
}

/** What an HTTP status from the provider means for what to do next. */
export function classifyTurnStatus(status: number): TurnStatus {
  if (status >= 200 && status < 300) return "ok";
  // 401 is the key being wrong; 403 is the key being right and not allowed to
  // do this. A person has to act on either, and no amount of retrying helps.
  if (status === 401 || status === 403) return "rejected";
  return "unavailable";
}

/**
 * Whether what came back is actually usable as an ICE server list.
 *
 * An empty array is a failure wearing a 200: handing a peer connection zero
 * servers is worse than handing it the STUN fallback, because it looks like
 * success everywhere the result is checked.
 */
export function isUsableIceServerList(value: unknown): value is { urls: string | string[] }[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const urls = (entry as { urls?: unknown }).urls;
    return typeof urls === "string" ? urls.length > 0 : Array.isArray(urls) && urls.length > 0;
  });
}

/**
 * The credentials URL.
 *
 * The key is escaped. It was interpolated raw, which is fine for the tidy
 * base64-ish keys a provider usually issues and silently wrong for anything
 * carrying a `+`, an `&` or a space — where the request arrives holding some
 * prefix of the key and the provider answers 401 about a credential that is
 * perfectly valid.
 */
export function meteredCredentialsUrl(appName: string, apiKey: string): string {
  return `https://${encodeURIComponent(appName)}.metered.live/api/v1/turn/credentials`
    + `?apiKey=${encodeURIComponent(apiKey)}`;
}

/**
 * What to write in the server log, addressed to whoever has to fix it.
 *
 * Deliberately names the environment variable, the likely cause and the action.
 * The line this replaces said `Metered returned 401`, which is true, was
 * emitted five times over ten weeks, and told nobody what to do about it.
 */
export function turnFailureLog(input: {
  reason: TurnUnavailableReason;
  status?: number;
  appName: string;
  dirty: boolean;
}): string {
  const where = `METERED_APP_NAME="${input.appName}"`;
  switch (input.reason) {
    case "unconfigured":
      return "[turn] METERED_API_KEY is not set — meetings will run on STUN only, and guests behind symmetric NAT or CGNAT will fail to connect.";
    case "rejected":
      return [
        `[turn] Metered REJECTED the credential (HTTP ${input.status ?? "401"}).`,
        input.dirty
          ? "The value of METERED_API_KEY had surrounding whitespace or quotes, which this build stripped before sending — if this persists, the key itself is wrong."
          : "METERED_API_KEY is being sent exactly as stored, so the key is revoked, expired, or belongs to another app.",
        `Check the key and that ${where} matches the Metered app subdomain.`,
        "Until fixed, every meeting runs on STUN only and guests on restrictive networks cannot connect.",
      ].join(" ");
    default:
      return `[turn] Metered unreachable or failing (HTTP ${input.status ?? "network error"}) — falling back to STUN for now. ${where}`;
  }
}
