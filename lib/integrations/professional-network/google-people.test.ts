// Tests for the Google People API pull. Pure: fetchGooglePeople against an
// injected fake fetch (no network), the connection→ProfileInput mapping, and
// the Google Contacts connector's availability/connect shape.

import {
  fetchGooglePeople,
  mapConnectionToProfileInput,
} from "./google-people.server";
import { googleContactsConnector } from "./connectors";
import { fromGoogleContacts } from "./adapters";
import type { NormalizedProfile } from "./types";

// A representative /connections payload: full name + org + email + a LinkedIn
// URL among several urls, a names-only person, and one identified only by a
// LinkedIn URL.
const PAGE_1 = {
  connections: [
    {
      names: [{ displayName: "Jane Doe", givenName: "Jane", familyName: "Doe" }],
      emailAddresses: [{ value: "jane@example.com" }],
      organizations: [{ name: "Acme Capital", title: "Managing Partner" }],
      phoneNumbers: [{ value: "+1 555 111 2222" }],
      urls: [
        { value: "https://example.com", type: "homePage" },
        { value: "https://www.linkedin.com/in/jane-doe", type: "profile" },
      ],
    },
    {
      names: [{ displayName: "Bob Smith", givenName: "Bob", familyName: "Smith" }],
    },
    {
      urls: [{ value: "linkedin.com/in/carla-fund" }],
    },
  ],
  nextPageToken: "page-2",
};

const PAGE_2 = {
  connections: [
    {
      names: [{ displayName: "Dana Lee", givenName: "Dana", familyName: "Lee" }],
      emailAddresses: [{ value: "dana@fund.io" }],
    },
  ],
};

function fakeFetch(pages: unknown[]): typeof fetch {
  let call = 0;
  return (async () => {
    const body = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

describe("mapConnectionToProfileInput", () => {
  it("maps names, org (title/company), email, phone, and detects a LinkedIn url", () => {
    const input = mapConnectionToProfileInput(PAGE_1.connections[0]);
    expect(input).toEqual({
      fullName: "Jane Doe",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "+1 555 111 2222",
      title: "Managing Partner",
      company: "Acme Capital",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe",
    });
  });

  it("does not invent a LinkedIn url when none of the urls are LinkedIn", () => {
    const input = mapConnectionToProfileInput({
      names: [{ displayName: "No Social" }],
      urls: [{ value: "https://example.com" }],
    });
    expect(input.linkedinUrl).toBeUndefined();
  });

  it("detects a bare (scheme-less) linkedin.com url", () => {
    const input = mapConnectionToProfileInput(PAGE_1.connections[2]);
    expect(input.linkedinUrl).toBe("linkedin.com/in/carla-fund");
  });
});

describe("fetchGooglePeople", () => {
  it("maps a sample payload across pages into ProfileInputs", async () => {
    const results = await fetchGooglePeople("access-token", fakeFetch([PAGE_1, PAGE_2]));
    // 3 from page 1 + 1 from page 2.
    expect(results).toHaveLength(4);
    expect(results[0]).toMatchObject({
      fullName: "Jane Doe",
      email: "jane@example.com",
      company: "Acme Capital",
      title: "Managing Partner",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe",
    });
    expect(results[3]).toMatchObject({ fullName: "Dana Lee", email: "dana@fund.io" });
  });

  it("sends the access token as a Bearer header and requests the right fields", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const spyFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return { ok: true, status: 200, json: async () => PAGE_2 } as Response;
    }) as unknown as typeof fetch;

    await fetchGooglePeople("secret-token", spyFetch);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("people.googleapis.com/v1/people/me/connections");
    expect(seen[0].url).toContain("personFields=names");
    const headers = seen[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
  });

  it("throws on a non-OK response so the sync job records a failure", async () => {
    const badFetch = (async () =>
      ({ ok: false, status: 403, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    await expect(fetchGooglePeople("t", badFetch)).rejects.toThrow(/403/);
  });

  it("mapped inputs normalize cleanly through the contacts adapter", () => {
    const results = mapConnectionToProfileInput(PAGE_1.connections[0]);
    const normalized = fromGoogleContacts(results);
    expect("error" in normalized).toBe(false);
    const profile = normalized as NormalizedProfile;
    expect(profile.source).toBe("contacts");
    expect(profile.email).toBe("jane@example.com");
    expect(profile.linkedin_url).toBe("https://www.linkedin.com/in/jane-doe");
    expect(profile.company).toBe("Acme Capital");
  });
});

describe("googleContactsConnector shape", () => {
  it("exposes a People vault key and a dedicated connect URL", () => {
    expect(googleContactsConnector.secretKey).toBe("GOOGLE_PEOPLE_REFRESH_TOKEN");
    // connectUrl points at the dedicated People start route (distinct from Gmail).
    expect(googleContactsConnector.connectUrl("org-1")).toContain(
      "/api/oauth/google/people/start",
    );
  });

  it("reports a well-formed availability result (pending when OAuth unconfigured)", () => {
    const availability = googleContactsConnector.availability();
    if (availability.available) {
      expect(availability).toEqual({ available: true });
    } else {
      expect(availability.available).toBe(false);
      expect(typeof availability.reason).toBe("string");
      expect(availability.reason.length).toBeGreaterThan(0);
    }
  });
});
