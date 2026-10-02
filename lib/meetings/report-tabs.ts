// lib/meetings/report-tabs.ts
// The report page's tabs: which exist for a given report, and which one a URL
// hash asks for.
//
// The report had become one long scroll — summary, action items, decisions,
// the follow-up draft, an hour of transcript and the chat — and the part most
// people came for after the meeting (the follow-up, or a moment in the
// recording) was a long way down. Each tab is a hash, so a link to
// `/report#follow-up`, which the meetings list already sends people to, lands
// on it.
//
// Pure: no DOM.

export type ReportTab = "overview" | "follow-up" | "media" | "chat" | "details";

export interface ReportTabSpec {
  id: ReportTab;
  label: string;
  /** A short count or state beside the label, if any. */
  badge?: string | null;
  /**
   * Only below `lg`. On a wide screen the details — who was there, the
   * versions, the inbox history — sit beside every tab, so a tab for them
   * would be a second copy.
   */
  narrowOnly?: boolean;
}

/** The hash each tab answers to, and the older anchors that should land on it. */
const HASHES: Record<ReportTab, readonly string[]> = {
  overview: ["overview", "summary", "action-items", "decisions"],
  "follow-up": ["follow-up"],
  media: ["recording", "transcript"],
  chat: ["chat"],
  details: ["details", "participants", "versions"],
};

/** The hash written when a tab is chosen. */
export function tabHash(tab: ReportTab): string {
  return HASHES[tab][0];
}

/**
 * The tab a hash asks for, among those this report has. Anything unknown, or a
 * tab this report does not have (a follow-up link on a report without one),
 * is the overview rather than an empty page.
 */
export function tabFromHash(hash: string | null | undefined, available: readonly ReportTab[]): ReportTab {
  const key = (hash ?? "").replace(/^#/, "").toLowerCase();
  for (const tab of available) {
    if (HASHES[tab].includes(key)) return tab;
  }
  return "overview";
}

/** The tabs a report has, in order. */
export function reportTabs(report: {
  hasFollowUp: boolean;
  followUpBadge?: string | null;
  hasRecording: boolean;
  hasTranscript: boolean;
  chatCount: number;
  actionItemCount: number;
}): ReportTabSpec[] {
  const tabs: ReportTabSpec[] = [
    { id: "overview", label: "Overview", badge: report.actionItemCount ? String(report.actionItemCount) : null },
  ];
  if (report.hasFollowUp) tabs.push({ id: "follow-up", label: "Follow-up", badge: report.followUpBadge ?? null });
  if (report.hasRecording || report.hasTranscript) {
    tabs.push({ id: "media", label: report.hasRecording ? "Recording & transcript" : "Transcript" });
  }
  if (report.chatCount > 0) tabs.push({ id: "chat", label: "Chat", badge: String(report.chatCount) });
  tabs.push({ id: "details", label: "Details", narrowOnly: true });
  return tabs;
}
