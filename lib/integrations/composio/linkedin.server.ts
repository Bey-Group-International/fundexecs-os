// LinkedIn routed through Composio's OFFICIAL LinkedIn API tools
// (LINKEDIN_GET_MY_INFO / LINKEDIN_GET_PERSON) — compliant by construction.
//
// Honest scope, stated plainly: LinkedIn's official API exposes the authenticated
// member's own profile and app-scoped member ids only. It does NOT resolve an
// arbitrary public profile URL to data, and it offers no connection-list export.
// So there is deliberately no bulk "import my connections" here and no scraping
// fallback — the same stance connectors.ts already documents. What Composio adds
// is a REAL, verified identity for the connected member (confidence: linkedin_api
// baseline) and best-effort enrichment of a member the app already holds an
// app-scoped id for.
//
// Mappers are pure; the sync/enrich paths are the only Composio + DB touch points.

import { normalizeProfile } from "@/lib/integrations/professional-network/normalize-profile";
import { addProfessionalContact } from "@/lib/integrations/professional-network/pipeline.server";
import type {
  AdapterResult,
} from "@/lib/integrations/professional-network/adapters";
import type {
  ConnectorSyncContext,
  ConnectorSyncResult,
  ProfileInput,
} from "@/lib/integrations/professional-network/types";
import {
  composioConfigForOrg,
  executeComposioTool,
  type ComposioConfig,
} from "./client.server";

export const COMPOSIO_LINKEDIN_ME_TOOL = "LINKEDIN_GET_MY_INFO";
export const COMPOSIO_LINKEDIN_PERSON_TOOL = "LINKEDIN_GET_PERSON";

/** The OpenID-style profile LINKEDIN_GET_MY_INFO returns (fields vary/nest). */
interface LinkedInProfile {
  name?: string;
  given_name?: string;
  family_name?: string;
  localizedFirstName?: string;
  localizedLastName?: string;
  email?: string;
  headline?: string;
  vanityName?: string;
  publicProfileUrl?: string;
  sub?: string;
  id?: string;
}

function str(...vals: Array<unknown>): string | undefined {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

/**
 * Map a LinkedIn official-API profile into ProfileInput. Pure — no I/O. Handles
 * the OpenID (name/given_name) and the classic (localizedFirstName) shapes.
 */
export function mapLinkedInProfileToInput(profile: LinkedInProfile | null | undefined): ProfileInput {
  const first = str(profile?.given_name, profile?.localizedFirstName);
  const last = str(profile?.family_name, profile?.localizedLastName);
  const vanity = str(profile?.vanityName);
  const linkedinUrl =
    str(profile?.publicProfileUrl) ?? (vanity ? `https://www.linkedin.com/in/${vanity}` : undefined);

  return {
    firstName: first,
    lastName: last,
    fullName: str(profile?.name),
    email: str(profile?.email),
    title: str(profile?.headline),
    linkedinUrl,
  };
}

/** Adapter form: normalize a LinkedIn profile as a verified `linkedin_api` record. */
export function fromLinkedInApi(profile: LinkedInProfile | null | undefined): AdapterResult {
  return normalizeProfile(mapLinkedInProfileToInput(profile), "linkedin_api");
}

export interface LinkedInDeps {
  /** Test seam: a ready ComposioConfig; when provided, skips key resolution. */
  composio?: ComposioConfig | null;
}

/**
 * Verify the LinkedIn connection and import the authenticated member's OWN
 * verified profile into the graph as a `linkedin_api` contact. This is the only
 * bulk-free, scraping-free thing LinkedIn's official API permits; it anchors the
 * principal's canonical identity for outreach + relationship attribution.
 * Never throws — returns a persistable ConnectorSyncResult.
 */
export async function syncLinkedInSelf(
  orgId: string,
  ctx: ConnectorSyncContext,
  deps: LinkedInDeps = {},
): Promise<ConnectorSyncResult> {
  const config = deps.composio !== undefined ? deps.composio : await composioConfigForOrg(orgId);
  if (!config) {
    return {
      ok: false,
      recordsSeen: 0,
      recordsImported: 0,
      error: "LinkedIn is not connected via Composio for this organization.",
    };
  }

  const res = await executeComposioTool<LinkedInProfile>(config, COMPOSIO_LINKEDIN_ME_TOOL, {});
  if (!res.ok) {
    return { ok: false, recordsSeen: 0, recordsImported: 0, error: res.error };
  }

  const normalized = fromLinkedInApi(res.data);
  if ("error" in normalized) {
    return { ok: false, recordsSeen: 1, recordsImported: 0, error: normalized.error };
  }

  const result = await addProfessionalContact(ctx.supabase, {
    orgId,
    userId: ctx.userId,
    profile: normalized,
  });

  if (result.ok) return { ok: true, recordsSeen: 1, recordsImported: 1, recordsDeduped: 0 };
  if (result.needsReview) return { ok: true, recordsSeen: 1, recordsImported: 0, recordsDeduped: 1 };
  return { ok: false, recordsSeen: 1, recordsImported: 0, error: result.error };
}

/**
 * Best-effort enrichment of a member the app already references by APP-SCOPED
 * person id (never a public URL — the official API cannot resolve those).
 * Returns a normalized `linkedin_api` profile or null on any miss.
 */
export async function enrichLinkedInPerson(
  orgId: string,
  personId: string,
  deps: LinkedInDeps = {},
): Promise<AdapterResult | null> {
  const config = deps.composio !== undefined ? deps.composio : await composioConfigForOrg(orgId);
  if (!config || !personId?.trim()) return null;

  const res = await executeComposioTool<LinkedInProfile>(config, COMPOSIO_LINKEDIN_PERSON_TOOL, {
    person_id: personId.trim(),
  });
  if (!res.ok) return null;
  return fromLinkedInApi(res.data);
}
