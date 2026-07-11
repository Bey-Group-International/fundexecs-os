// Institutional meeting-prep prompt builder.
//
// "Prepare with Earn" gathers the meeting plus its linked deal / fund and asks
// Earn for a rigorous, fund-manager-grade preparation pack. Keeping the prompt
// construction here (pure, no I/O) makes it unit-testable and keeps the route
// thin. Only sections with real data are included, so an under-specified meeting
// produces a shorter — but still structured — brief rather than empty headers.

export interface PrepAttendee {
  name: string;
  email?: string | null;
  type?: "internal" | "external" | string | null;
}

export interface PrepMeeting {
  title: string;
  meetingType?: string | null;
  priority?: string | null;
  scheduledAt?: string | null;
  timezone?: string | null;
  durationMinutes?: number | null;
  objective?: string | null;
  agenda?: string | null;
  preparationRequirements?: string | null;
  description?: string | null;
  location?: string | null;
  tags?: string[] | null;
  attendees?: PrepAttendee[] | null;
}

export interface PrepDeal {
  name: string;
  stage?: string | null;
  assetClass?: string | null;
  geography?: string | null;
  targetAmount?: number | null;
  expectedClose?: string | null;
  notes?: string | null;
}

export interface PrepFund {
  name: string;
  fundType?: string | null;
  vintageYear?: number | null;
  targetSize?: number | null;
  committedCapital?: number | null;
  calledCapital?: number | null;
  distributedCapital?: number | null;
  currency?: string | null;
}

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s || null;
}

function titleCase(v: string | null | undefined): string | null {
  const s = clean(v);
  return s ? s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

/** Compact money formatting: 25000000 -> "$25.0M", 900000 -> "$900.0K". */
export function formatMoney(amount: number | null | undefined, currency = "USD"): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  const sym = currency === "USD" ? "$" : `${currency} `;
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${sym}${(amount / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sym}${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${(amount / 1_000).toFixed(1)}K`;
  return `${sym}${amount.toFixed(0)}`;
}

function formatWhen(iso: string | null | undefined, timezone: string | null | undefined, durationMinutes: number | null | undefined): string | null {
  const s = clean(iso);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const tz = clean(timezone) ?? "UTC";
  let when: string;
  try {
    when = d.toLocaleString("en-US", {
      timeZone: tz, weekday: "short", month: "short", day: "numeric",
      year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
  } catch {
    when = d.toISOString();
  }
  const dur = durationMinutes && durationMinutes > 0 ? ` (${durationMinutes} min)` : "";
  return `${when}${dur}`;
}

function attendeeLines(attendees: PrepAttendee[] | null | undefined): string | null {
  if (!attendees || attendees.length === 0) return null;
  const lines = attendees
    .map((a) => {
      const name = clean(a.name);
      if (!name) return null;
      const type = clean(a.type as string | null | undefined);
      const email = clean(a.email);
      const meta = [type, email].filter(Boolean).join(", ");
      return `  - ${name}${meta ? ` (${meta})` : ""}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

function section(title: string, rows: Array<[string, string | null]>): string | null {
  const present = rows.filter(([, v]) => clean(v));
  if (present.length === 0) return null;
  return `${title}\n${present.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;
}

/**
 * Compose the full institutional prep prompt. Returns a single string suitable
 * for handing to Earn (the copilot).
 */
export function buildPrepPrompt(input: { meeting: PrepMeeting; deal?: PrepDeal | null; fund?: PrepFund | null }): string {
  const { meeting, deal, fund } = input;

  const blocks: string[] = [];

  blocks.push(
    "You are Earn, an institutional meeting-preparation analyst for a fund manager. " +
      "Using the context below, produce a rigorous, decision-oriented preparation pack in an institutional tone " +
      "(suitable for LPs, deal teams, and advisors). Be specific and concise; use the actual names and figures provided.",
  );

  const meetingBlock = section("MEETING", [
    ["Title", clean(meeting.title)],
    ["Type", titleCase(meeting.meetingType)],
    ["Priority", titleCase(meeting.priority)],
    ["When", formatWhen(meeting.scheduledAt, meeting.timezone, meeting.durationMinutes)],
    ["Location", clean(meeting.location)],
    ["Objective", clean(meeting.objective)],
    ["Agenda", clean(meeting.agenda)],
    ["Prep notes", clean(meeting.preparationRequirements)],
    ["Description", clean(meeting.description)],
    ["Tags", meeting.tags && meeting.tags.length ? meeting.tags.join(", ") : null],
  ]);
  if (meetingBlock) blocks.push(meetingBlock);

  const att = attendeeLines(meeting.attendees);
  if (att) blocks.push(`ATTENDEES\n${att}`);

  if (deal) {
    const dealBlock = section("DEAL", [
      ["Name", clean(deal.name)],
      ["Stage", titleCase(deal.stage)],
      ["Asset class", clean(deal.assetClass)],
      ["Geography", clean(deal.geography)],
      ["Target amount", formatMoney(deal.targetAmount)],
      ["Expected close", clean(deal.expectedClose)],
      ["Notes", clean(deal.notes)],
    ]);
    if (dealBlock) blocks.push(dealBlock);
  }

  if (fund) {
    const cur = clean(fund.currency) ?? "USD";
    const fundBlock = section("FUND / VEHICLE", [
      ["Name", clean(fund.name)],
      ["Type", titleCase(fund.fundType)],
      ["Vintage", fund.vintageYear ? String(fund.vintageYear) : null],
      ["Target size", formatMoney(fund.targetSize, cur)],
      ["Committed", formatMoney(fund.committedCapital, cur)],
      ["Called", formatMoney(fund.calledCapital, cur)],
      ["Distributed", formatMoney(fund.distributedCapital, cur)],
    ]);
    if (fundBlock) blocks.push(fundBlock);
  }

  blocks.push(
    [
      "Produce the following, each as a short, skimmable section. Omit a section only if there is truly nothing useful to say.",
      "1. Counterparty & attendee background — who they are, what they likely care about, and their probable posture.",
      "2. Deal / fund context that matters for THIS conversation.",
      "3. Objective & the specific outcome to secure.",
      "4. Recommended agenda / flow with rough time allocation.",
      "5. Likely questions & objections — each with a crisp, credible answer.",
      "6. Risks & watch-items to manage, and how to defuse them.",
      "7. Talking points & positioning (institutional tone, numbers where relevant).",
      "8. Materials & data to bring or have on hand.",
      "9. The decision(s) to secure and how to close toward them.",
      "10. Follow-up plan — owners and next steps.",
      "",
      "End with a short 'Gather before the meeting' list of anything missing from the context above that I should confirm.",
    ].join("\n"),
  );

  return blocks.join("\n\n");
}
