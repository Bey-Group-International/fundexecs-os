// app/api/csp-report/route.ts
// Receives the browser's report of what the investor pages' report-only Content-Security-Policy
// would have blocked (SOC 2 gap G-4), and logs a reduced form of it (lib/csp-report.ts: no page
// URL, no script text, since the page URL is a bearer link).
//
// Public by necessity (a browser posts it with no credentials), so it is deliberately inert:
// it stores nothing, answers 204 to everything, ignores large bodies unread, and logs at most
// a fixed number of lines a minute per server instance.
import { NextResponse } from "next/server";
import { createLogLimiter, MAX_REPORT_BYTES, summarizeCspReport } from "@/lib/csp-report";

export const dynamic = "force-dynamic";

const limiter = createLogLimiter(60, 60_000);

export async function POST(request: Request) {
  try {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_REPORT_BYTES) return new NextResponse(null, { status: 204 });
    const text = await request.text();
    if (text.length > MAX_REPORT_BYTES) return new NextResponse(null, { status: 204 });
    const violations = summarizeCspReport(JSON.parse(text));
    for (const v of violations) {
      if (!limiter.allow(Date.now())) break;
      console.warn("[csp-report]", v);
    }
  } catch {
    // Not JSON, or unreadable: nothing to say.
  }
  return new NextResponse(null, { status: 204 });
}
