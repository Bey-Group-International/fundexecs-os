/**
 * The in-call chat panel, measured in a real browser engine.
 *
 * This is the half of the overflow defect that jsdom cannot see. A message
 * bubble with no `break-words` renders identically in jsdom to one with it —
 * every rect jsdom reports is zero — so the component test can only assert
 * that the rule is on the element. Whether a pasted URL actually makes the
 * panel scroll sideways is a question for a layout engine, and this asks it.
 *
 * Measured as horizontal overflow rather than through the shared
 * `viewport-escape` check, which does not fire here and was never going to:
 * Tailwind's `overflow-y-auto` sets only one axis, and CSS computes the other
 * to `auto` whenever its pair is not `visible`. So the panel does not burst
 * out of the page — it quietly becomes a sideways scroller, and every message
 * in it goes off-screen together while somebody drags to read one URL. That is
 * the defect, and `scrollWidth > clientWidth` is what it looks like.
 *
 * A URL is not a contrived input. It is the single most common thing anybody
 * pastes into a meeting chat.
 */

// The room module is imported for one presentational component, and it pulls
// in the whole client surface behind it. None of this affects layout.
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useParams: () => ({ roomId: "abc-defg-hij" }),
  useSearchParams: () => new URLSearchParams(),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, pageHtml } from "@/test-utils/visual";
import { CopilotSidebar } from "@/app/(app)/meetings/[roomId]/MeetingRoom";
import type { ChatMessage } from "@/lib/meetings/chat";

const exe = chromiumPath();

if (!exe && process.env.CI) {
  throw new Error(
    "Chromium not found and CI=true. The visual checks cannot run — install it " +
      "with `npx playwright install --with-deps chromium`.",
  );
}

const describeVisual = exe ? describe : describe.skip;
if (!exe) {
  console.warn("[visual] Chromium not found — skipping. `npx playwright install chromium`");
}

let browser: Browser;

beforeAll(async () => {
  const { chromium } = require("playwright-core") as typeof import("playwright-core");
  browser = await chromium.launch({ executablePath: exe!, args: ["--no-sandbox"] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * The dense case: a long URL, a long unbroken token, a long name, and both
 * delivery states — everything that adds width to a message at once.
 */
const MESSAGES: ChatMessage[] = [
  { id: "m1", from: "p2", displayName: "Rae", text: "shall we start?", ts: 1_000 },
  {
    id: "m2",
    from: "p2",
    displayName: "Rae Okafor-Lindqvist (Operations)",
    text: "https://example.com/reports/fund-iv/quarterly-limited-partner-update-2026-q3-final-v4.pdf?download=1&signature=abcdef0123456789",
    ts: 2_000,
  },
  {
    id: "m3",
    from: "p1",
    displayName: "Alina",
    text: "Supercalifragilisticexpialidociousaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ts: 3_000,
    delivery: "failed",
  },
  { id: "m4", from: "p1", displayName: "Alina", text: "on the number", ts: 4_000, delivery: "sending" },
];

function panel(chatMessages: ChatMessage[]): string {
  return renderToStaticMarkup(
    React.createElement(CopilotSidebar, {
      srStatus: "active" as const,
      participants: [
        { id: "p1", displayName: "Alina", micOn: true, isLocal: true },
        { id: "p2", displayName: "Rae Okafor-Lindqvist (Operations)", micOn: false, isLocal: false },
      ],
      speaking: new Set<string>(),
      roomCode: "abc-defg-hij",
      meetingTitle: "Fund IV quarterly sync",
      chatMessages,
      chatUnread: 0,
      onSendChat: () => {},
      onRetryChat: () => {},
      isHost: true,
      raisedHands: new Set<string>(),
      onKick: () => {},
      onAdmit: () => {},
      onDeny: () => {},
      onAdmitAll: () => {},
      waitingPeers: [],
      onChatVisibility: () => {},
      onCollapse: () => {},
    }),
  );
}

/**
 * Every element in the panel that scrolls sideways.
 *
 * Reported with the text that made it overflow, because "something is 340px
 * too wide" is not actionable and "the bubble holding this URL is" is.
 */
async function sidewaysScrollers(markup: string, width: number): Promise<string[]> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await page.setContent(await pageHtml(markup), { waitUntil: "load" });
    return (await page.evaluate(`(${COLLECT})()`)) as string[];
  } finally {
    await page.close();
  }
}

// Serialised into the page, so it cannot close over anything out here. One
// pixel of slack because sub-pixel layout rounds against us on some widths.
const COLLECT = function collect(): string[] {
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const label = (el.textContent ?? "").trim().slice(0, 60);
    out.push(`<${el.tagName.toLowerCase()}> is ${el.scrollWidth - el.clientWidth}px too wide: ${label}`);
  }
  return out;
};

describeVisual("Meeting chat layout", () => {
  for (const vp of VIEWPORTS) {
    it(`holds a pasted URL inside the panel at ${vp.width}px`, async () => {
      const over = await sidewaysScrollers(panel(MESSAGES), vp.width);
      expect(over).toEqual([]);
    }, 60_000);
  }

  // The control: ordinary messages never overflowed, so a check that passed on
  // them and on the dense case alike would be proving nothing.
  it("is not passing because the panel is empty", async () => {
    const short: ChatMessage[] = [
      { id: "s1", from: "p2", displayName: "Rae", text: "shall we start?", ts: 1_000 },
    ];
    expect(await sidewaysScrollers(panel(short), 400)).toEqual([]);
    // And the panel really did render the dense case — otherwise the check
    // above is measuring an empty box.
    expect(panel(MESSAGES)).toContain("quarterly-limited-partner-update");
  }, 60_000);
});
