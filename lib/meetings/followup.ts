// Institutional meeting follow-up prompt builder.
//
// "Follow up with Earn" gathers the just-completed meeting plus its linked deal /
// fund and (optionally) the saved report notes, then asks Earn for a rigorous,
// fund-manager-grade POST-MEETING follow-up pack. Keeping the prompt construction
// here (pure, no I/O) makes it unit-testable and keeps the route thin. Only
// sections with real data are included, so an under-specified meeting produces a
// shorter — but still structured — brief rather than empty headers.
//
// Deliberately self-contained: it does NOT import from prep.ts so the two
// features can evolve independently.

export interface FollowupAttendee {
  name: string;
  email?: string | null;
  type?: "internal" | "external" | string | null;
}

export interface FollowupMeeting {
  title: string;
  meetingType?: string | null;
  priority?: string | null;
  scheduledAt?: string | null;
  timezone?: string | null;
  durationMinutes?: number | null;
  objective?: string | null;
  agenda?: string | null;
  attendees?: FollowupAttendee[] | null;
}

export interface FollowupDeal {
  name: string;
  stage?: string | null;
  assetClass?: string | null;
  geography?: string | null;
  targetAmount?: number | null;
  expectedClose?: string | null;
  notes?: string | null;
}

export interface FollowupFund {
  name: string;
  fundType?: string | null;
  vintageYear?: number | null;
  targetSize?: number | null;
  committedCapital?: number | null;
  calledCapital?: number | null;
  distributedCapital?: number | null;
  currency?: string | null;
}

/** Captured artifacts from a saved post-meeting report, if one exists. */
export interface FollowupNotes {
  summary?: string | null;
  actionItems?: string[] | null;
  keyPoints?: string[] | null;
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

function attendeeLines(attendees: FollowupAttendee[] | null | undefined): string | null {
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

function bulletList(items: string[] | null | undefined): string | null {
  if (!items || items.length === 0) return null;
  const lines = items.map((i) => clean(i)).filter(Boolean).map((i) => `  - ${i}`);
  return lines.length ? lines.join("\n") : null;
}

function section(title: string, rows: Array<[string, string | null]>): string | null {
  const present = rows.filter(([, v]) => clean(v));
  if (present.length === 0) return null;
  return `${title}\n${present.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;
}

/**
 * Compose the full institutional post-meeting follow-up prompt. Returns a single
 * string suitable for handing to Earn (the copilot).
 */
export function buildFollowupPrompt(input: {
  meeting: FollowupMeeting;
  deal?: FollowupDeal | null;
  fund?: FollowupFund | null;
  notes?: FollowupNotes | null;
}): string {
  const { meeting, deal, fund, notes } = input;

  const blocks: string[] = [];

  blocks.push(
    "You are Earn, an institutional analyst for a fund manager. The meeting below has just concluded. " +
      "Using the context and any captured notes provided, produce a rigorous, decision-oriented POST-MEETING follow-up pack " +
      "in an institutional tone (suitable for LPs, deal teams, advisors, and — where relevant — regulatory review). " +
      "Be specific and concise; use the actual names and figures provided and do not invent facts that are not supported by the context.",
  );

  const meetingBlock = section("MEETING", [
    ["Title", clean(meeting.title)],
    ["Type", titleCase(meeting.meetingType)],
    ["Priority", titleCase(meeting.priority)],
    ["When", formatWhen(meeting.scheduledAt, meeting.timezone, meeting.durationMinutes)],
    ["Objective", clean(meeting.objective)],
    ["Agenda", clean(meeting.agenda)],
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

  if (notes) {
    const summary = clean(notes.summary);
    if (summary) blocks.push(`CAPTURED SUMMARY\n${summary}`);
    const keyPoints = bulletList(notes.keyPoints);
    if (keyPoints) blocks.push(`CAPTURED KEY POINTS\n${keyPoints}`);
    const actionItems = bulletList(notes.actionItems);
    if (actionItems) blocks.push(`CAPTURED ACTION ITEMS\n${actionItems}`);
  }

  blocks.push(
    [
      "Produce the following, each as a short, skimmable section. Omit a section only if there is truly nothing useful to say; do not emit empty headers.",
      "1. Recap — a concise summary of what was discussed and where things stand.",
      "2. Decisions made — the concrete decisions reached, stated unambiguously.",
      "3. Action items — a table of owner, item, and due date; be explicit about who owns what and by when.",
      "4. Risks & watch-items — open issues, dependencies, and anything to monitor, with how to manage each.",
      "5. Approval-sensitive language — flag any statements, commitments, or figures that require compliance, LP, or regulatory review, with suggested wording appropriate for LP/regulatory contexts.",
      "6. CRM / next-step updates — the fields, stages, and records to update in the CRM as a result of this meeting.",
      "7. Follow-up email — a ready-to-send draft (greeting, brief recap, decisions, numbered action items with owners and dates, and a professional sign-off).",
      "8. Proposed next meeting — a recommended purpose, timing, and required attendees.",
      "",
      "End with a short 'Confirm before sending' list of anything ambiguous in the context above that I should verify before acting.",
    ].join("\n"),
  );

  return blocks.join("\n\n");
}
