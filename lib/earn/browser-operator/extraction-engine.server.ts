// lib/earn/browser-operator/extraction-engine.server.ts
//
// The server-side orchestrator that turns a live, browser-FREE extraction into a
// review record — WITHOUT saving anything into real system records. It:
//
//   1. Enforces source-policy: only the browser-free public sources this seam
//      supports (edgar / company_website / public_web) are allowed here.
//   2. Calls the right source module (EDGAR JSON API or a public-web GET).
//   3. Builds a review record and INSERTs one `earn_review_queue` row (pending).
//   4. Writes a `data_extracted` audit row.
//   5. Drives the session machine extracting → normalizing → awaiting_user_review.
//
// Data only enters real records later, on explicit operator approval (see the
// approve-extraction route). Nothing is persisted to real records here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, EarnBrowserSession, Json } from "@/lib/supabase/database.types";
import type { BrowserDataSource, ExtractedDataPoint } from "./types";
import { policyForSource } from "./source-policy";
import { buildReviewRecord, type ReviewRecord } from "./review-queue";
import { transitionSession, writeAudit } from "./server";
import { extractFromEdgar } from "./sources/edgar.server";
import { extractFromPublicWeb } from "./sources/public-web.server";
import type { HttpFetch } from "./sources/http";

type Client = SupabaseClient<Database>;

/** The browser-FREE public sources this seam can extract live, server-side. */
export const LIVE_EXTRACTION_SOURCES: BrowserDataSource[] = [
  "edgar",
  "company_website",
  "public_web",
];

export function isLiveExtractionSource(source: BrowserDataSource): boolean {
  return LIVE_EXTRACTION_SOURCES.includes(source);
}

/** Where to point the extractor: an EDGAR query, or a public URL. */
export interface ExtractionTarget {
  /** EDGAR ticker or company-name query. */
  query?: string;
  /** Public URL for company_website / public_web. */
  url?: string;
  /** Max EDGAR filings to include. */
  limit?: number;
}

export interface RunExtractionArgs {
  session: EarnBrowserSession;
  source: BrowserDataSource;
  target: ExtractionTarget;
  /** Injectable HTTP layer (defaults to real fetch); keeps this testable. */
  http?: HttpFetch;
}

export type RunExtractionResult =
  | {
      ok: true;
      session: EarnBrowserSession;
      review: ReviewRecord;
      points: ExtractedDataPoint[];
      reviewQueueId: string;
      destination: string;
    }
  | {
      ok: false;
      reason: "policy_rejected" | "invalid_target" | "no_data" | "illegal_transition" | "source_error" | "db_error";
      message: string;
      from?: string;
    };

/** Extract points from the correct source module. No DB, no session I/O. */
async function extractPoints(
  source: BrowserDataSource,
  target: ExtractionTarget,
  http?: HttpFetch,
): Promise<{ ok: true; points: ExtractedDataPoint[]; url?: string } | { ok: false; message: string }> {
  if (source === "edgar") {
    if (!target.query?.trim()) return { ok: false, message: "EDGAR extraction needs a ticker or company name." };
    const res = await extractFromEdgar({ query: target.query, limit: target.limit, http });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true, points: res.points };
  }
  // company_website / public_web
  if (!target.url?.trim()) return { ok: false, message: "Public-web extraction needs a URL." };
  const res = await extractFromPublicWeb({ url: target.url, source, http });
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, points: res.points, url: res.url };
}

/** A short business-language destination hint for the whole review batch. */
function proposedDestination(source: BrowserDataSource): string {
  return source === "edgar" ? "edgar_filing_records" : "diligence_report";
}

/**
 * Run a live, browser-free extraction end to end, producing a review record and
 * a pending review-queue row. Drives the session machine; rejects out-of-policy
 * sources and illegal session states without persisting real records.
 */
export async function runExtraction(
  supabase: Client,
  args: RunExtractionArgs,
): Promise<RunExtractionResult> {
  const { source, target } = args;

  // 1. Policy: only the browser-free public sources are allowed at this seam.
  if (!isLiveExtractionSource(source)) {
    return {
      ok: false,
      reason: "policy_rejected",
      message: `Source '${source}' is not a browser-free live-extraction source.`,
    };
  }
  const policy = policyForSource(source);
  if (!policy.allowed_actions.includes("extract_data")) {
    return { ok: false, reason: "policy_rejected", message: `Extraction is not permitted for '${source}'.` };
  }

  // 2. Move the session into `extracting` (legal only from navigating /
  //    user_auth_completed / already extracting). Illegal state → caller 409s.
  let session = args.session;
  if (session.status !== "extracting") {
    const begin = await transitionSession(supabase, session, "begin_extraction");
    if (!begin.ok && begin.reason === "illegal_transition") {
      return { ok: false, reason: "illegal_transition", message: "Session is not in a state that can begin extraction.", from: begin.from };
    }
    if (!begin.ok) return { ok: false, reason: "db_error", message: begin.error };
    session = begin.session;
  }

  await writeAudit(supabase, {
    orgId: session.organization_id,
    sessionId: session.id,
    userId: session.user_id,
    input: { action: "extraction_started", sourceType: source, url: target.url ?? session.current_url ?? null },
  });

  // 3. Extract from the source module.
  const extracted = await extractPoints(source, target, args.http);
  if (!extracted.ok) {
    await transitionSession(supabase, session, "fail");
    await writeAudit(supabase, {
      orgId: session.organization_id,
      sessionId: session.id,
      userId: session.user_id,
      input: { action: "session_failed", sourceType: source, summary: extracted.message },
    });
    return { ok: false, reason: "source_error", message: extracted.message };
  }
  const points = extracted.points;
  if (points.length === 0) {
    await transitionSession(supabase, session, "fail");
    await writeAudit(supabase, {
      orgId: session.organization_id,
      sessionId: session.id,
      userId: session.user_id,
      input: { action: "session_failed", sourceType: source, summary: "No data points extracted." },
    });
    return { ok: false, reason: "no_data", message: "No data points were extracted from the source." };
  }

  // 4. extracting → normalizing.
  const norm = await transitionSession(supabase, session, "extraction_complete", {
    current_url: extracted.url ?? session.current_url,
  });
  if (!norm.ok) {
    return { ok: false, reason: norm.reason === "illegal_transition" ? "illegal_transition" : "db_error", message: norm.reason === "db_error" ? norm.error : "Could not advance to normalizing.", from: norm.reason === "illegal_transition" ? norm.from : undefined };
  }
  session = norm.session;

  // 5. Build the review record + enqueue a pending review-queue row.
  const review = buildReviewRecord(points);
  const destination = proposedDestination(source);
  const { data: queued, error: queueErr } = await supabase
    .from("earn_review_queue")
    .insert({
      organization_id: session.organization_id,
      session_id: session.id,
      proposed_destination: destination,
      fields: points as unknown as Json,
      status: "pending",
    })
    .select("id")
    .single();
  if (queueErr || !queued) {
    return { ok: false, reason: "db_error", message: queueErr?.message ?? "Could not enqueue review." };
  }

  await writeAudit(supabase, {
    orgId: session.organization_id,
    sessionId: session.id,
    userId: session.user_id,
    input: {
      action: "data_extracted",
      sourceType: source,
      url: extracted.url ?? session.current_url ?? null,
      summary: `Extracted ${points.length} field(s) from ${source}; ${review.summary.low_confidence} need confirmation.`,
    },
  });

  // 6. normalizing → awaiting_user_review.
  const review_ready = await transitionSession(supabase, session, "normalization_complete", {
    review_required: true,
  });
  if (!review_ready.ok) {
    return { ok: false, reason: review_ready.reason === "illegal_transition" ? "illegal_transition" : "db_error", message: review_ready.reason === "db_error" ? review_ready.error : "Could not advance to review." };
  }
  session = review_ready.session;

  await writeAudit(supabase, {
    orgId: session.organization_id,
    sessionId: session.id,
    userId: session.user_id,
    input: { action: "review_requested", sourceType: source, summary: "Extracted data sent for field-level review." },
  });

  return {
    ok: true,
    session,
    review,
    points,
    reviewQueueId: queued.id as string,
    destination,
  };
}
