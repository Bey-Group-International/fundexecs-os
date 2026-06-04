import type { FetchContext, NormalizedContact, NormalizedInteraction, Provider } from '../types';

const APOLLO = 'https://api.apollo.io/api/v1';

interface ApolloOrganization {
  name?: string;
}

interface ApolloContact {
  email?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  organization_name?: string;
  organization?: ApolloOrganization;
}

/**
 * Apollo adapter. Pulls saved contacts/people for enrichment — it emits
 * contacts only (company + title), no interactions, since Apollo records are
 * a CRM enrichment source rather than a touchpoint signal.
 *
 * OAuth/auth: Apollo authenticates with an API key (NOT the Google session
 * token). Store the key on `integration_connections.metadata.access_token`;
 * the sync route resolves it from there and passes it as `token`. Apollo
 * expects it in the `X-Api-Key` header.
 * Docs: https://docs.apollo.io/reference/contact-search
 */
export const apolloProvider: Provider = {
  id: 'apollo',
  label: 'Apollo',

  async fetchSignals({ token }: FetchContext) {
    const res = await fetch(`${APOLLO}/contacts/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Api-Key': token
      },
      body: JSON.stringify({ page: 1, per_page: 100 })
    });
    if (!res.ok) {
      throw new Error(`Apollo API error ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { contacts?: ApolloContact[] };

    const contacts: NormalizedContact[] = [];
    for (const person of body.contacts ?? []) {
      const email = person.email?.toLowerCase();
      if (!email) continue;
      const fullName =
        (person.name ?? [person.first_name, person.last_name].filter(Boolean).join(' ').trim()) ||
        undefined;
      contacts.push({
        email,
        fullName,
        title: person.title ?? undefined,
        company: person.organization_name ?? person.organization?.name ?? undefined
      });
    }

    // Apollo is an enrichment source; it produces no touchpoint interactions.
    const interactions: NormalizedInteraction[] = [];
    return { contacts, interactions };
  }
};
