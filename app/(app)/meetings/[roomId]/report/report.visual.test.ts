/**
 * The report page, measured in a real browser engine.
 *
 * Written for the two-column layout: a sticky sidebar of participants, the
 * follow-up's status and the report's versions beside the report itself, a stats
 * strip under the title, and action items that now carry an owner and a due
 * date on the same row as their text. jsdom asserts all of that is in the DOM;
 * it cannot say whether any of it still fits at phone width.
 *
 * The hostile case on purpose: a long title, long names, a long unbroken
 * address, and every section populated at once.
 *
 * Set VISUAL_SCREENSHOTS=<dir> to also write a PNG per width for eyeballing.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
// An async server component; streamed in production, out of scope here.
jest.mock("./AttendeeHistory", () => ({ AttendeeHistoryPanel: () => null }));

const MEETING = {
  id: "m1",
  host_id: "host-1",
  title: "Dunbar Capital — Series B follow-up with the whole syndicate, counsel and the LP advisory committee",
  created_at: "2026-09-23T14:00:00.000Z",
  started_at: "2026-09-23T14:00:00.000Z",
  ended_at: "2026-09-23T15:12:00.000Z",
  scheduled_at: null,
  kind: "meeting",
  recording_consent: null,
  organization_id: "org-1",
  attendees: [{ name: "Priya Shah-Lindqvist", email: "priya.shah-lindqvist@very-long-limited-partner-domain.example" }],
};

const REPORT = {
  summary:
    "The syndicate agreed to proceed to confirmatory diligence at a $40M pre-money, subject to counsel's review of the side letter and the LPAC's sign-off on the co-invest allocation.",
  key_points: ["Valuation moved from $36M to $40M pre", "Side letter MFN clause needs counsel review", "Co-invest allocation capped at 15%"],
  action_items: [
    "Priya: Circulate the redlined side letter to counsel by Friday",
    "Alex: Book the LPAC call for next Thursday",
    "Confirm the wire instructions with the administrator",
  ],
  analysis: {
    decisions: ["Proceed to confirmatory diligence", "Cap co-invest at 15%"],
    sentiment: "positive",
    next_meeting_suggestion: "Reconvene next Thursday once counsel has reviewed the side letter.",
    follow_up_draft:
      "Hi {{first_name}},\n\nThanks for your time today. **Here is where we landed:**\n\n- Proceed to confirmatory diligence\n- Cap co-invest at 15%\n\nNext steps:\n1. Priya to circulate the redlined side letter by Friday\n2. Alex to book the LPAC call\n\nBest,\nAlex Rivera",
  },
  full_transcript: "Alex: Let's begin.\nPriya: Agreed.",
};

const SIDE = {
  participants: [
    { name: "Alex Rivera", email: "alex@fundexecs.com", role: "host", attended: true, receivesFollowUp: false },
    { name: "Priya Shah-Lindqvist", email: "priya.shah-lindqvist@very-long-limited-partner-domain.example", role: "invitee", attended: true, receivesFollowUp: true },
    { name: "Marcus Oyelaran-Whitfield", email: "marcus@fund.example", role: "attendee", attended: true, receivesFollowUp: true },
    { name: "Guest (phone)", email: null, role: "attendee", attended: true, receivesFollowUp: false },
  ],
  hostName: "Alex Rivera",
  followUp: { kind: "drafted", threads: 2 },
  tasks: [
    { id: "t1", title: "x", status: "completed", dueAt: "2026-09-25T00:00:00.000Z", assignedTo: "u-priya", assigneeName: "Priya Shah-Lindqvist", actionItem: "Priya: Circulate the redlined side letter to counsel by Friday" },
    { id: "t2", title: "x", status: "pending", dueAt: "2026-10-01T00:00:00.000Z", assignedTo: "host-1", assigneeName: "Alex Rivera", actionItem: "Alex: Book the LPAC call for next Thursday" },
  ],
};

jest.mock("@/lib/meetings/report-side.server", () => ({ loadReportSide: async () => SIDE }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "host-1", email: "alex@fundexecs.com" } } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        range: async () => ({ data: [], error: null }),
        maybeSingle: async () => {
          if (table === "live_meetings") return { data: MEETING };
          if (table === "live_meeting_reports") return { data: REPORT };
          if (table === "live_meeting_participants") return { data: { meeting_id: "m1" } };
          return { data: null };
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve),
      };
      return chain;
    },
  }),
}));

import MeetingReportPage from "./page";

const exe = chromiumPath();
if (!exe && process.env.CI) {
  throw new Error("Chromium not found and CI=true. The visual checks cannot run.");
}
const describeVisual = exe ? describe : describe.skip;

let browser: Browser;
let markup = "";

beforeAll(async () => {
  const { chromium } = require("playwright-core") as typeof import("playwright-core");
  browser = await chromium.launch({ executablePath: exe!, args: ["--no-sandbox"] });
  const ui = await MeetingReportPage({ params: Promise.resolve({ roomId: "dun-bar-42" }) });
  markup = renderToStaticMarkup(ui as React.ReactElement);
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

const WIDTHS = [{ name: "narrow", width: 360 }, ...VIEWPORTS];

describeVisual("the report page's layout", () => {
  for (const { name, width } of WIDTHS) {
    it(`holds together at ${name} (${width}px)`, async () => {
      const issues = await inspect(browser, markup, { width });
      if (issues.length) throw new Error(report("report page", width, issues));

      const dir = process.env.VISUAL_SCREENSHOTS;
      if (dir) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.setContent(await pageHtml(markup), { waitUntil: "load" });
        await page.screenshot({ path: `${dir}/report-${name}.png`, fullPage: true });
        await page.close();
      }
    }, 120_000);
  }
});
