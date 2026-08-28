// lib/session-share.ts
//
// Who may read a shared session. The decision is pulled out of the page so the
// security boundary is a pure function with tests, rather than a chain of ifs
// inside a component that renders with the RLS-bypassing service client.
//
// Two scopes:
//   'public' — the token is the only gate. Anyone with the link reads it.
//   'org'    — the token names the session; membership of the sharing org is
//              the gate. A signed-out visitor is asked to sign in; a signed-in
//              visitor from another org is told nothing beyond "unavailable".

export type ShareScope = "public" | "org";

/** What the viewer should be shown. */
export type ShareAccess = "allow" | "sign_in" | "deny";

export interface ShareAccessInput {
  /** The share row's scope, or null when no share resolved for the token. */
  scope: ShareScope | null;
  /** The org that owns the share. */
  shareOrgId: string | null;
  /** The signed-in viewer, or null when nobody is signed in. */
  viewer: { userId: string } | null;
  /** Whether the viewer is a member of `shareOrgId`. Only consulted for 'org'. */
  viewerIsOrgMember: boolean;
}

/**
 * Deliberately fails closed: anything not explicitly recognised is a deny.
 *
 * Note the asymmetry between "sign in" and "deny". Prompting a signed-out
 * visitor to sign in reveals only that the token exists, which they already
 * hold. Telling a signed-in outsider the same thing would confirm the link
 * belongs to a specific org they aren't in — so they get the same blank wall
 * as a bad token.
 */
export function resolveShareAccess(input: ShareAccessInput): ShareAccess {
  if (!input.scope) return "deny";

  if (input.scope === "public") return "allow";

  if (input.scope === "org") {
    // A share with no owning org can never be matched against a membership.
    if (!input.shareOrgId) return "deny";
    if (!input.viewer) return "sign_in";
    return input.viewerIsOrgMember ? "allow" : "deny";
  }

  return "deny";
}

/** The label a viewer sees, so the page never misrepresents its own reach. */
export function shareScopeLabel(scope: ShareScope): string {
  return scope === "public" ? "Shared read-only" : "Shared with your team";
}
