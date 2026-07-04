// Shared plumbing for the /api/v1 surface. Every v1 route is authenticated by an
// issued secret key and scoped to that key's organization, so the auth + error
// handling + service client lives here once. Routes stay a thin query + shape.
//
// Responses use a consistent envelope: { data } for a resource, { data, count }
// for a collection, { error } for failures — so consumers can rely on one shape.
import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys-verify";
import { createServiceClient } from "@/lib/supabase/server";
import type { ApiKeyMode } from "@/lib/supabase/database.types";

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface ApiContext {
  /** The organization the presented key belongs to. Scope every query to it. */
  orgId: string;
  mode: ApiKeyMode;
  keyId: string;
  /** The key's granted scopes — already checked against the route's requirement. */
  scopes: string[];
  /** Service-role client — the caller has no Supabase session. Always scope by orgId. */
  supabase: ServiceClient;
}

/**
 * Wrap a v1 GET handler with secret-key auth. The handler only runs once the key
 * is verified; it receives the resolved org context, a service client, and the
 * original request (so a route can read query params like ?cursor=/?limit=).
 * Auth failures (401/503) are returned before the handler is reached.
 *
 * `requiredScope` is the route's blast-radius gate: a key without it gets a 403
 * naming the missing scope. Omit only for identity endpoints (whoami) — every
 * data route must name its scope.
 */
export function withApiKey(
  handler: (ctx: ApiContext, request: Request) => Promise<NextResponse> | NextResponse,
  requiredScope?: string,
) {
  return async (request: Request): Promise<NextResponse> => {
    const auth = await requireApiKey(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (requiredScope && !auth.key.scopes.includes(requiredScope)) {
      return NextResponse.json(
        { error: `This key is missing the required scope: ${requiredScope}` },
        { status: 403 },
      );
    }
    return handler(
      {
        orgId: auth.key.orgId,
        mode: auth.key.mode,
        keyId: auth.key.keyId,
        scopes: auth.key.scopes,
        supabase: createServiceClient(),
      },
      request,
    );
  };
}

/** A single resource: { data }. */
export function resource<T>(data: T): NextResponse {
  return NextResponse.json({ data });
}

/** A collection: { data, count, nextCursor }. Pass nextCursor for a paginated
 * list (null once there's no further page); omit it for an unpaginated one. */
export function collection<T>(rows: T[], nextCursor: string | null = null): NextResponse {
  return NextResponse.json({ data: rows, count: rows.length, nextCursor });
}

/** A failure with an explicit status. */
export function failure(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

/** A write parked for human approval: 202 Accepted with the pending handle —
 * the request was understood and queued, but nothing has been committed. */
export function accepted<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 202 });
}
