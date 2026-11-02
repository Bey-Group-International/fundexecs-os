// app/api/csp-report/route.ts
// Receives the browser's report of what the investor pages' report-only Content-Security-Policy
// would have blocked (SOC 2 gap G-4), and logs a reduced form of it (lib/csp-report.ts: no page
// URL, no script text, since the page URL is a bearer link).
//
// Public by necessity (a browser posts it with no credentials), so it is deliberately inert:
// it stores nothing, answers 204 to everything, ignores large bodies unread, and logs at most
// a fixed number of lines a minute per server instance.
import { NextResponse } from "next/server";
import { MAX_REPORT_BYTES, summarizeCspReport } from "@/lib/csp-report";

export const dynamic = "force-dynamic";

const LOG_WINDOW_MS = 60_000;
const MAX_LOGS_PER_WINDOW = 60;
let windowStart = 0;
let logged = 0;

function mayLog(now: number): boolean {
  if (now - windowStart >= LOG_WINDOW_MS) {
    windowStart = now;
    logged = 0;
  }
  if (logged >= MAX_LOGS_PER_WINDOW) return false;
  logged += 1;
  return true;
}

/** Test seam: forget the rate-limit window. */
export function resetCspReportLimit(): void {
  windowStart = 0;
  logged = 0;
}

export async function POST(request: Request) {
  try {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_REPORT_BYTES) return new NextResponse(null, { status: 204 });
    const text = await request.text();
    if (text.length > MAX_REPORT_BYTES) return new NextResponse(null, { status: 204 });
    const violations = summarizeCspReport(JSON.parse(text));
    for (const v of violations) {
      if (!mayLog(Date.now())) break;
      console.warn("[csp-report]", v);
    }
  } catch {
    // Not JSON, or unreadable: nothing to say.
  }
  return new NextResponse(null, { status: 204 });
}
