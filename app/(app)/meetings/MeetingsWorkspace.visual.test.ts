/**
 * The meetings workspace's rows and preview, measured in a real browser engine.
 *
 * A row now carries far more than a title and a status: a reason chip, priority,
 * follow-up state, a deal, tags, a presence count, stacked avatars, hover actions,
 * a ⋯ menu and Join. jsdom can say they are present; it cannot say whether a row
 * holding all of them is still a row at phone width. The hostile case on purpose.
 *
 * Set VISUAL_SCREENSHOTS=<dir> to also write a PNG per width for eyeballing.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";
import { MeetingRow, type MeetingRowProps } from "./MeetingRow";
import { MeetingPreview } from "./MeetingPreview";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";

const exe = chromiumPath();
if (!exe && process.env.CI) {
  throw new Error("Chromium not found and CI=true. The visual checks cannot run.");
}
const describeVisual = exe ? describe : describe.skip;

let browser: Browser;
beforeAll(async () => {
  const { chromium } = require("playwright-core") as typeof import("playwright-core");
  browser = await chromium.launch({ executablePath: exe!, args: ["--no-sandbox"] });
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

const noop = () => {};
function row(over: Partial<MeetingRowProps> = {}): MeetingRowProps {
  return {
    id: "m1",
    roomCode: "dun-bar-42",
    title: "Dunbar Capital — Series B follow-up with the whole syndicate, counsel and the LPAC",
    timeLabel: "10:30 AM",
    status: "Prep Needed",
    phase: "imminent",
    countdown: "Starts now",
    live: false,
    inRoom: 3,
    people: [
      { name: "Priya Shah-Lindqvist", email: "priya@lp.example" },
      { name: "Marcus Oyelaran-Whitfield", email: "marcus@fund.example" },
      { name: "Alex Rivera", email: "alex@fund.example" },
      { name: "Guest (phone)", email: null },
    ],
    chips: [
      { label: "Critical", tone: "danger" },
      { label: "Follow-up drafted", tone: "info" },
      { label: "Deal", tone: "accent" },
      { label: "fund-iii-co-invest-allocation", tone: "neutral" },
      { label: "lpac", tone: "neutral" },
    ],
    reason: "Needs prep",
    ended: false,
    selected: true,
    selectable: true,
    previewing: false,
    reminderState: null,
    copied: false,
    onSelect: noop, onPreview: noop, onPrep: noop, onFollowUp: noop, onCopyLink: noop,
    onRemind: noop, onEdit: noop, onDelete: noop,
    ...over,
  };
}

const MEETING = {
  id: "m1", room_code: "dun-bar-42",
  title: "Dunbar Capital — Series B follow-up with the whole syndicate, counsel and the LPAC",
  description: null, location: null, meeting_url: null, status: "waiting",
  scheduled_at: "2026-10-02T14:30:00.000Z", duration_minutes: 60, timezone: "America/New_York",
  meeting_type: "investment_committee", priority: "critical", tags: ["fund-iii-co-invest-allocation", "lpac"],
  attendees: [
    { name: "Priya Shah-Lindqvist", email: "priya.shah-lindqvist@very-long-limited-partner-domain.example", type: "external" },
    { name: "Alex Rivera", email: "alex@fund.example", type: "internal" },
    { name: "Guest (phone)", type: "external" },
  ],
  source: null, sync_status: null, source_event_id: null, source_calendar_id: null, deal_id: "d1",
  related_contact_id: null, related_fund_id: null,
  objective: "Agree the co-invest allocation and the side letter MFN position before the LPAC call.",
  agenda: "1. Valuation\n2. Side letter\n3. Allocation", preparation_requirements: null,
  preparation_status: "prep_needed", followup_status: "draft", assigned_copilot_agent: null,
  related_record_type: null, related_record_id: null, calendar_visibility: null, reminder_minutes: 30,
  external_calendar_provider: null, external_calendar_sync_enabled: true, external_calendar_sync_status: "sync_failed",
  is_draft: false, locked_at: null, updated_at: null, guest_quick_access: null,
} as unknown as UpcomingMeeting;

function rowsMarkup(): string {
  const rows = [
    row(),
    row({ id: "m2", title: "Quick sync", people: [], chips: [], reason: null, inRoom: 0, phase: "upcoming", selected: false }),
    row({ id: "m3", title: "Atlas IC debrief", ended: true, status: "Follow-Up Needed", phase: "ended", reason: "Follow-up needed" }),
  ];
  return renderToStaticMarkup(
    React.createElement(
      "div",
      { className: "mx-auto flex w-full max-w-5xl flex-col gap-1.5 px-4" },
      ...rows.map((r) => React.createElement(MeetingRow, { key: r.id, ...r })),
    ),
  );
}

/**
 * The preview on its own: beside the list on a wide screen, and a sheet over
 * the page on a narrow one — where covering the list is the point.
 */
function previewMarkup(): string {
  return renderToStaticMarkup(
    React.createElement(
      "div",
      { className: "mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_380px]" },
      React.createElement("div"),
      React.createElement(MeetingPreview, {
        meeting: MEETING, status: "Prep Needed", ended: false, live: false,
        room: { count: 3, names: ["Priya", "Alex", "Guest"] }, reminder: null, busy: false, confirmingDelete: false,
        onClose: noop, onPrep: noop, onFollowUp: noop, onEdit: noop, onRemind: noop, onRetrySync: noop,
        onRemoveFromCalendar: noop, onAskDelete: noop, onCancelDelete: noop, onDelete: noop,
      }),
    ),
  );
}

const WIDTHS = [{ name: "narrow", width: 360 }, ...VIEWPORTS];

describeVisual("the meetings workspace's rows and preview", () => {
  for (const [what, markup] of [["rows", rowsMarkup], ["preview", previewMarkup]] as const) {
    for (const { name, width } of WIDTHS) {
      it(`${what} hold together at ${name} (${width}px)`, async () => {
        const html = markup();
        const dir = process.env.VISUAL_SCREENSHOTS;
        if (dir) {
          const page = await browser.newPage({ viewport: { width, height: 900 } });
          await page.setContent(await pageHtml(html), { waitUntil: "load" });
          await page.screenshot({ path: `${dir}/workspace-${what}-${name}.png`, fullPage: true });
          await page.close();
        }

        // The preview's details scroll under its action footer by design; the
        // checker measures boxes, not what a scroll container clips, and reads
        // every row scrolled out of view as sitting on a button. So the height
        // cap is lifted for the measurement: every element is laid out in full,
        // and anything still overlapping is a real collision.
        const issues = await inspect(browser, html, {
          width,
          interact: async (page) => {
            await page.addStyleTag({
              content: "aside[role=dialog]{max-height:none!important;position:static!important}",
            });
          },
        });
        if (issues.length) throw new Error(report(`meetings workspace ${what}`, width, issues));
      }, 120_000);
    }
  }
});
