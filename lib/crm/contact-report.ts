// lib/crm/contact-report.ts
// The full communications report on one person: every conversation the inbox
// holds with them and every meeting they were in, as one document.
//
// Before this, the answer to "where are we with Ana?" was spread across three
// screens — the contact record's timeline, the inbox, and one meeting report
// per meeting — and none of them could be handed to anybody. This puts them in
// one chronological record and renders it through the same markdown exporters
// as the meeting report (md, html, rtf, docx, pdf).
//
// No model calls. Everything here is already summarised: a thread carries the
// inbox's own ai_summary (or its latest message's opening), and a meeting
// carries its report's summary, decisions and action items. A report is a
// read of what the product already knows, so generating one costs queries, not
// tokens, and two people exporting the same record get the same document.
//
// Pure: no database, no clock, no network.

import { boundedBody } from "@/lib/crm/contact-match";

/** One message, when the reader asked for the conversation itself. */
export interface ContactReportMessage {
  direction: "inbound" | "outbound" | string;
  author: string | null;
  body: string;
  occurredAt: string;
}

export interface ContactReportThread {
  id: string;
  channel: string;
  subject: string | null;
  /** ai_summary when there is one, else the latest message preview. */
  summary: string | null;
  status: string;
  unread: boolean;
  lastMessageAt: string | null;
  /** "address" when matched on the contact's email, "manual" when somebody linked it. */
  linkedBy: "address" | "manual";
  /** Oldest first. Only loaded when the reader asked for messages. */
  messages?: ContactReportMessage[];
}

export interface ContactReportMeeting {
  id: string;
  roomCode: string | null;
  title: string | null;
  at: string | null;
  summary: string | null;
  decisions: string[];
  actionItems: string[];
  /** False when the meeting has no report the reader may see. */
  hasReport: boolean;
  linkedBy: "address" | "manual";
}

export interface ContactReportInput {
  contact: {
    fullName: string;
    email: string | null;
    title: string | null;
    company: string | null;
    stage: string | null;
    lastActivityAt: string | null;
  };
  threads: ContactReportThread[];
  meetings: ContactReportMeeting[];
  /** When this document was produced. Passed in to keep the module pure. */
  generatedAt: string;
}

export interface ContactReportOptions {
  /** Reproduce each thread's messages, not only its summary. Off by default. */
  includeMessages?: boolean;
  /** Off for the renderers that draw the title themselves (see rendererDrawsTitle). */
  titleHeading?: boolean;
}

/** How many open action items the summary block lists before saying "and N more". */
export const ACTION_ITEMS_MAX = 25;
/** How many messages of one thread a report reproduces: the most recent ones. */
export const MESSAGES_PER_THREAD = 10;
/** How much of one message a report carries. */
export const MESSAGE_MAX = 2_000;
export const SUMMARY_MAX = 800;

const CHANNEL_LABEL: Record<string, string> = {
  gmail: "Email",
  slack: "Slack",
  calendly: "Booking",
  google_calendar: "Calendar",
  zoom: "Zoom",
  google_meet: "Google Meet",
  docusign: "DocuSign",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? channel.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/** "2 Oct 2026". UTC on purpose: a filed document has no reader time zone. */
function day(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function stamp(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${day(iso)}, ${time} UTC`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** One entry on the communications timeline, thread or meeting. */
export type ContactReportEntry =
  | { kind: "thread"; at: string | null; thread: ContactReportThread }
  | { kind: "meeting"; at: string | null; meeting: ContactReportMeeting };

/** Threads and meetings, newest first; undated entries last. */
export function reportEntries(input: Pick<ContactReportInput, "threads" | "meetings">): ContactReportEntry[] {
  const entries: ContactReportEntry[] = [
    ...input.threads.map((thread) => ({ kind: "thread" as const, at: thread.lastMessageAt, thread })),
    ...input.meetings.map((meeting) => ({ kind: "meeting" as const, at: meeting.at, meeting })),
  ];
  return entries.sort((a, b) => {
    const at = a.at ?? "";
    const bt = b.at ?? "";
    if (at === bt) return 0;
    if (!at) return 1;
    if (!bt) return -1;
    return at < bt ? 1 : -1;
  });
}

export interface ContactReportStats {
  threads: number;
  meetings: number;
  unread: number;
  openThreads: number;
  lastEmailAt: string | null;
  lastMeetingAt: string | null;
  /** Every meeting's action items, most recent meeting first. Not tracked as done or open. */
  actionItems: Array<{ item: string; meeting: string; at: string | null }>;
}

export function reportStats(input: Pick<ContactReportInput, "threads" | "meetings">): ContactReportStats {
  const latest = (values: Array<string | null>) =>
    values.filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
  const meetingsNewest = [...input.meetings].sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1));
  return {
    threads: input.threads.length,
    meetings: input.meetings.length,
    unread: input.threads.filter((t) => t.unread).length,
    openThreads: input.threads.filter((t) => t.status !== "done").length,
    lastEmailAt: latest(input.threads.map((t) => t.lastMessageAt)),
    lastMeetingAt: latest(input.meetings.map((m) => m.at)),
    actionItems: meetingsNewest.flatMap((m) =>
      m.actionItems.map((item) => ({ item, meeting: (m.title ?? "").trim() || "Meeting", at: m.at })),
    ),
  };
}

function fact(label: string, value: string | null | undefined): string | null {
  return value ? `- **${label}:** ${value}` : null;
}

function threadBlock(thread: ContactReportThread, options: ContactReportOptions): string[] {
  const subject = (thread.subject ?? "").trim() || "(no subject)";
  const lines = [`### ${day(thread.lastMessageAt) ?? "Undated"} — ${channelLabel(thread.channel)}: ${subject}`, ""];
  const meta = [
    thread.status === "done" ? "Closed" : thread.status === "snoozed" ? "Snoozed" : "Open",
    thread.unread ? "unread" : null,
    thread.linkedBy === "manual" ? "linked by hand" : null,
  ].filter(Boolean);
  lines.push(`*${meta.join(" · ")}*`, "");
  const summary = oneLine(thread.summary ?? "");
  lines.push(summary ? boundedBody(summary, SUMMARY_MAX) : "No summary was available for this conversation.", "");

  if (options.includeMessages && thread.messages?.length) {
    const shown = thread.messages.slice(-MESSAGES_PER_THREAD);
    const hidden = thread.messages.length - shown.length;
    if (hidden > 0) lines.push(`*${hidden} earlier message${hidden === 1 ? "" : "s"} not reproduced.*`, "");
    for (const m of shown) {
      const who = (m.author ?? "").trim() || (m.direction === "outbound" ? "Us" : "Them");
      const arrow = m.direction === "outbound" ? "→" : "←";
      lines.push(`**${arrow} ${who}** — ${stamp(m.occurredAt) ?? ""}`, "");
      const body = m.body.trim();
      // Quoted so a message's own markdown cannot restructure the document.
      lines.push(
        ...boundedBody(body || "(empty message)", MESSAGE_MAX)
          .split("\n")
          .map((l) => `> ${l}`),
        "",
      );
    }
  }
  return lines;
}

function meetingBlock(meeting: ContactReportMeeting): string[] {
  const title = (meeting.title ?? "").trim() || "Meeting";
  const lines = [`### ${day(meeting.at) ?? "Undated"} — Meeting: ${title}`, ""];
  if (meeting.linkedBy === "manual") lines.push("*Linked by hand*", "");
  if (!meeting.hasReport) {
    lines.push("No report is available for this meeting to you.", "");
    return lines;
  }
  const summary = oneLine(meeting.summary ?? "");
  lines.push(summary ? boundedBody(summary, SUMMARY_MAX) : "The report has no summary.", "");
  if (meeting.decisions.length) {
    lines.push("**Decisions**", "", ...meeting.decisions.map((d, i) => `${i + 1}. ${oneLine(d)}`), "");
  }
  if (meeting.actionItems.length) {
    lines.push("**Action items**", "", ...meeting.actionItems.map((a, i) => `${i + 1}. ${oneLine(a)}`), "");
  }
  if (meeting.roomCode) lines.push(`Reference: ${meeting.roomCode.toUpperCase()}`, "");
  return lines;
}

/** The report as markdown, for lib/artifacts/export to render in any format. */
export function buildContactReportMarkdown(
  input: ContactReportInput,
  options: ContactReportOptions = {},
): string {
  const name = input.contact.fullName.trim() || input.contact.email || "Contact";
  const stats = reportStats(input);
  const lines: string[] = options.titleHeading === false ? [] : [`# ${name} — Communications Report`, ""];

  const record = [
    fact("Email", input.contact.email),
    fact("Role", [input.contact.title, input.contact.company].filter(Boolean).join(", ") || null),
    fact("Stage", input.contact.stage ? input.contact.stage.replace(/_/g, " ") : null),
    fact("Last activity", day(input.contact.lastActivityAt)),
    fact("Generated", stamp(input.generatedAt)),
  ].filter(Boolean) as string[];
  lines.push("## Relationship Record", "", ...record, "");

  const glance = [
    `- **Conversations:** ${stats.threads} (${stats.openThreads} open, ${stats.unread} unread)`,
    `- **Meetings:** ${stats.meetings}`,
    fact("Last message", day(stats.lastEmailAt)),
    fact("Last meeting", day(stats.lastMeetingAt)),
  ].filter(Boolean) as string[];
  lines.push("## At a Glance", "", ...glance, "");

  if (stats.actionItems.length) {
    const shown = stats.actionItems.slice(0, ACTION_ITEMS_MAX);
    lines.push(
      "## Action Items From Meetings",
      "",
      ...shown.map((a) => `- ${oneLine(a.item)} *(${a.meeting}${day(a.at) ? `, ${day(a.at)}` : ""})*`),
    );
    const more = stats.actionItems.length - shown.length;
    if (more > 0) lines.push(`- *…and ${more} more in the meetings below.*`);
    lines.push("");
  }

  const entries = reportEntries(input);
  lines.push("## Communications", "");
  if (entries.length === 0) {
    lines.push("No conversations or meetings are linked to this person yet.", "");
  } else {
    for (const entry of entries) {
      lines.push(...(entry.kind === "thread" ? threadBlock(entry.thread, options) : meetingBlock(entry.meeting)));
    }
  }

  lines.push(
    "---",
    "",
    `*Compiled by FundExecs from the inbox and meeting records linked to this person${
      options.includeMessages ? ", with each conversation's most recent messages reproduced" : ""
    }. Conversation and meeting summaries are model-generated and should be read as a starting point, not as minutes.*`,
    "",
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** "ana-lopez-communications-2026-10-02.pdf" */
export function contactReportFilename(name: string, generatedAt: string, extension: string): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      // Combining marks out first, so "López" is "lopez" rather than "lo-pez".
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "contact";
  const date = Number.isNaN(Date.parse(generatedAt)) ? "" : `-${generatedAt.slice(0, 10)}`;
  return `${slug}-communications${date}.${extension}`;
}
