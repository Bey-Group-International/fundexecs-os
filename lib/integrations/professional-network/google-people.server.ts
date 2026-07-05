// Google People API pull for the Professional Network layer.
//
// Two isolated pieces so the network call is trivially mockable:
//   1. fetchGooglePeople(accessToken, fetchImpl?) — the pure HTTP read. Pages
//      through the authorized user's connections and maps each into the shared
//      ProfileInput shape. No DB, no token resolution; inject a fake fetch.
//   2. syncGooglePeople(orgId, ctx, fetchImpl?) — the orchestration: resolve a
//      People access token from the org's vaulted refresh token, pull, then run
//      each connection through the adapter → addProfessionalContact pipeline so
//      Google Contacts lands identically to every other source. Called by
//      googleContactsConnector.sync.
//
// Nothing here scrapes: it reads only the connections the user authorized under
// the contacts.readonly scope, and only the personFields we request.

import { getGooglePeopleAccessToken } from "@/lib/google-oauth";
import { fromGoogleContacts } from "./adapters";
import { addProfessionalContact } from "./pipeline.server";
import type {
  ConnectorSyncContext,
  ConnectorSyncResult,
  ProfileInput,
} from "./types";

type FetchLike = typeof fetch;

const PEOPLE_CONNECTIONS_URL = "https://people.googleapis.com/v1/people/me/connections";
const PERSON_FIELDS = "names,emailAddresses,organizations,phoneNumbers,urls";
// People caps pageSize at 1000; a hung read shouldn't stall the whole sync job.
const PAGE_SIZE = "1000";
const FETCH_TIMEOUT_MS = 15_000;
// Defensive cap so a pathological account can't page forever.
const MAX_PAGES = 50;

// ── People API response shapes (only the fields we request) ───────────────────

interface PeopleName {
  displayName?: string;
  givenName?: string;
  familyName?: string;
}
interface PeopleEmail {
  value?: string;
}
interface PeopleOrganization {
  name?: string;
  title?: string;
}
interface PeoplePhone {
  value?: string;
}
interface PeopleUrl {
  value?: string;
  type?: string;
}
interface PeopleConnection {
  names?: PeopleName[];
  emailAddresses?: PeopleEmail[];
  organizations?: PeopleOrganization[];
  phoneNumbers?: PeoplePhone[];
  urls?: PeopleUrl[];
}
interface PeopleConnectionsResponse {
  connections?: PeopleConnection[];
  nextPageToken?: string;
}

function isLinkedInUrl(value: string | undefined): boolean {
  if (!value) return false;
  return /(^|\.|\/\/)linkedin\.com\//i.test(value.trim());
}

/** Map one People connection to the shared ProfileInput shape. */
export function mapConnectionToProfileInput(person: PeopleConnection): ProfileInput {
  const name = person.names?.[0];
  const org = person.organizations?.[0];
  const linkedin = person.urls?.find((u) => isLinkedInUrl(u.value))?.value;

  return {
    fullName: name?.displayName,
    firstName: name?.givenName,
    lastName: name?.familyName,
    email: person.emailAddresses?.[0]?.value,
    phone: person.phoneNumbers?.[0]?.value,
    title: org?.title,
    company: org?.name,
    linkedinUrl: linkedin,
  };
}

/**
 * Read the authorized user's Google connections. Pure HTTP: pass an access
 * token and (optionally) an injected fetch. Throws on a non-OK response so the
 * caller records the sync job as failed rather than silently empty.
 */
export async function fetchGooglePeople(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProfileInput[]> {
  const out: ProfileInput[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const params = new URLSearchParams({ personFields: PERSON_FIELDS, pageSize: PAGE_SIZE });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetchImpl(`${PEOPLE_CONNECTIONS_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`google people fetch failed: ${res.status}`);

    const body = (await res.json()) as PeopleConnectionsResponse;
    for (const person of body.connections ?? []) {
      out.push(mapConnectionToProfileInput(person));
    }
    pageToken = body.nextPageToken;
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);

  return out;
}

/**
 * Full Google Contacts sync: resolve a People access token from the org's
 * vaulted refresh token, pull connections, and route each through the shared
 * normalize → dedupe → insert pipeline. Degrades cleanly (never throws) to a
 * result the sync-job recorder can persist:
 *   - no token (not connected / OAuth unconfigured) → ok:false with a reason
 *   - fetch failure → ok:false with the reason
 *   - success → counts of records seen / created / deduped
 */
export async function syncGooglePeople(
  orgId: string,
  ctx: ConnectorSyncContext,
  fetchImpl: FetchLike = fetch,
): Promise<ConnectorSyncResult> {
  const accessToken = await getGooglePeopleAccessToken(orgId);
  if (!accessToken) {
    return {
      ok: false,
      recordsSeen: 0,
      recordsImported: 0,
      error: "Google Contacts is not connected for this organization (authorize via Settings › Integrations).",
    };
  }

  let people: ProfileInput[];
  try {
    people = await fetchGooglePeople(accessToken, fetchImpl);
  } catch (err) {
    return {
      ok: false,
      recordsSeen: 0,
      recordsImported: 0,
      error: err instanceof Error ? err.message : "Google People fetch failed",
    };
  }

  let created = 0;
  let deduped = 0;
  for (const input of people) {
    const normalized = fromGoogleContacts(input);
    if ("error" in normalized) continue; // seen but not mappable (no identity)

    const result = await addProfessionalContact(ctx.supabase, {
      orgId,
      userId: ctx.userId,
      profile: normalized,
    });
    if (result.ok) {
      created += 1;
    } else if (result.needsReview) {
      // A high-confidence duplicate — respected, not force-inserted.
      deduped += 1;
    }
    // A hard insert error is skipped so one bad row can't fail the whole sync.
  }

  return {
    ok: true,
    recordsSeen: people.length,
    recordsImported: created,
    recordsDeduped: deduped,
  };
}
