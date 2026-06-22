import { NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import {
  parseTrackQuery,
  verifyTrackToken,
  isSafeInternalHref,
} from "@/lib/digest-tracking";

// The digest engagement tracker — the implicit half of the Radar learning loop.
// Reached from Slack/email (inboxes we don't control), so it is UNAUTHENTICATED
// by design. Forgery is prevented instead by an HMAC token over the link params
// (see lib/digest-tracking): a row can only be created from a link this server
// actually signed. It never throws to the client.
export const dynamic = "force-dynamic";

// A 1×1 transparent GIF — the open-pixel response body.
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function pixelResponse(): NextResponse {
  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRANSPARENT_GIF.length),
      // Never cache: each open is its own signal, and proxies must re-fetch.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

/**
 * GET /api/digest/track — record a digest open/click and route on.
 *
 * Safety: the link carries an HMAC (`t`) over its params, signed by the send
 * service with DIGEST_TRACK_SECRET / CRON_SECRET. We re-derive the signature and
 * reject any mismatch, so the endpoint can't be used to spam engagement rows.
 * For clicks, the redirect target must be a same-origin/relative path — absolute
 * external URLs are rejected — so a signed link can never become an open redirect.
 *
 *   action=clicked → 302 to the validated internal href (records "clicked")
 *   action=opened  → 1×1 transparent GIF (records "opened")
 *
 * Best-effort: a failed insert never blocks the redirect/pixel, and nothing here
 * ever throws to the caller.
 */
export async function GET(request: Request) {
  let action: "opened" | "clicked" = "opened";
  let href: string | null = null;

  try {
    const url = new URL(request.url);
    const { params, token } = parseTrackQuery(url.searchParams);
    action = params.action === "clicked" ? "clicked" : "opened";
    href = params.href ?? null;

    // No secret configured → the digest shipped plain links and shouldn't be
    // hitting this endpoint. Degrade gracefully: redirect a safe href, else pixel.
    const secret = process.env.DIGEST_TRACK_SECRET || process.env.CRON_SECRET;
    if (!secret) {
      if (action === "clicked" && isSafeInternalHref(href)) {
        return NextResponse.redirect(new URL(href!, url.origin), 302);
      }
      return pixelResponse();
    }

    // Verify the HMAC before trusting any param. On mismatch, do NOT write a row;
    // still route the user sensibly (a safe href, else a pixel) so a stale/bad
    // token never strands them.
    const valid =
      Boolean(params.digestLogId) &&
      Boolean(params.orgId) &&
      verifyTrackToken(secret, params, token);

    if (valid && hasSupabaseServiceEnv()) {
      // Best-effort insert via the service client (the caller has no session).
      try {
        const supabase = createServiceClient();
        await supabase.from("radar_digest_engagement").insert({
          organization_id: params.orgId,
          digest_log_id: params.digestLogId || null,
          entity_id: params.entityId || null,
          entity_name: null,
          entity_kind: params.entityKind || null,
          move_kind: params.moveKind || null,
          action,
        });
      } catch {
        // Swallow — engagement is a soft signal; never block the user.
      }
    }

    if (action === "clicked") {
      // Only ever redirect to a same-origin/relative path — reject external URLs.
      if (isSafeInternalHref(href)) {
        return NextResponse.redirect(new URL(href!, url.origin), 302);
      }
      // Unsafe/absent destination → fall back to the app root, never an external host.
      return NextResponse.redirect(new URL("/", url.origin), 302);
    }
    return pixelResponse();
  } catch {
    // Absolute backstop: never throw to the client.
    if (action === "clicked") {
      try {
        const origin = new URL(request.url).origin;
        if (isSafeInternalHref(href)) {
          return NextResponse.redirect(new URL(href!, origin), 302);
        }
        return NextResponse.redirect(new URL("/", origin), 302);
      } catch {
        // fall through to pixel
      }
    }
    return pixelResponse();
  }
}
