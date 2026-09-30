/**
 * What a contact's timeline claims about how it knows who an entry is with.
 *
 * "Automatic" says the app wrote the row rather than a person. A reader takes
 * that further — that the app knew what it was doing — and for an inbound
 * conversation it did not: the address is the message's own From header, written
 * by whoever sent it. The webhook signature authenticates the provider, not the
 * sender.
 *
 * So this asserts the one thing the UI can honestly do about that, and asserts
 * it on rows built by the REAL writers rather than on hand-written metadata: an
 * inbox row says the sender is unverified, and a meeting row does not.
 */
import { render, screen } from "@testing-library/react";

import { ContactRecordView } from "./ContactRecordView";
import { threadActivity } from "@/lib/inbox/crm-activity";
import { meetingActivities } from "@/lib/meetings/crm-activity";
import type { ContactRecord, TimelineEntry } from "@/lib/network-contact";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const CONTACT: ContactRecord = {
  id: "contact-ana",
  fullName: "Ana Diaz",
  firstName: "Ana",
  lastName: "Diaz",
  title: null,
  company: "Acme",
  companyDomain: "acme.com",
  email: "ana@acme.com",
  phone: null,
  linkedinUrl: null,
  avatarUrl: null,
  location: null,
  capitalRole: null,
  relationshipType: null,
  stage: "engaged",
  visibility: "org",
  ownerId: null,
  ownerName: null,
  strengthScore: 50,
  strengthLabel: "Warm",
  relevanceScore: 0,
  tags: [],
  custom: {},
  notes: null,
  source: null,
  connectedOn: null,
  addedAt: null,
  lastActivityAt: null,
  nextStepAt: null,
  verified: false,
  confidence: 0,
  communicationStatus: "ok",
  consentBasis: null,
  consentAt: null,
  complianceFlags: [],
  archivedAt: null,
  mergedIntoId: null,
};

/** The inbox writer's real output, as a timeline row. */
function inboxEntry(): TimelineEntry {
  const row = threadActivity({
    thread: {
      id: "thr-1",
      channel: "gmail",
      subject: "Q3 pacing",
      counterpartyEmail: "ana@acme.com",
      aiSummary: "Ana asked for the updated pacing model.",
      preview: null,
      lastMessageAt: "2026-09-23T14:00:00.000Z",
    },
    contactsByEmail: new Map([["ana@acme.com", "contact-ana"]]),
    now: "2026-09-30T08:00:00.000Z",
  })!;
  return {
    id: "act-inbox",
    type: row.activityType,
    direction: row.direction,
    subject: row.subject,
    body: row.body,
    occurredAt: row.occurredAt,
    actorId: null,
    actorName: null,
    isSystem: row.isSystem,
    metadata: row.metadata as unknown as Record<string, unknown>,
    misattributedAt: null,
    misattributionReason: null,
    misattributedByName: null,
  };
}

/** The meetings writer's real output, as a timeline row. */
function meetingEntry(): TimelineEntry {
  const row = meetingActivities({
    meeting: {
      id: "m1",
      roomCode: "abc-def-gh",
      title: "Dunbar follow-up",
      startedAt: "2026-09-23T14:00:00.000Z",
      scheduledAt: "2026-09-23T13:55:00.000Z",
      endedAt: "2026-09-23T14:40:00.000Z",
      durationMinutes: 40,
      hostEmail: "host@fundexecs.test",
      fromBookingLink: false,
    },
    invited: [{ name: "Ana Diaz", email: "ana@acme.com" }],
    attendedEmails: ["ana@acme.com"],
    contactsByEmail: new Map([["ana@acme.com", "contact-ana"]]),
    report: { summary: "Walked the pacing.", decisions: [] },
    siteUrl: "https://app.test",
  })[0];
  return {
    id: "act-meeting",
    type: row.activityType,
    direction: row.direction,
    subject: row.subject,
    body: row.body,
    occurredAt: row.occurredAt,
    actorId: null,
    actorName: null,
    isSystem: row.isSystem,
    metadata: row.metadata as unknown as Record<string, unknown>,
    misattributedAt: null,
    misattributionReason: null,
    misattributedByName: null,
  };
}

function view(timeline: TimelineEntry[]) {
  render(
    <ContactRecordView
      initial={{ contact: CONTACT, timeline, tasks: [], possibleDuplicates: [] }}
      owners={[]}
      currentUserId="principal-1"
      canDelete={false}
      canCorrect={false}
    />,
  );
}

describe("how the timeline labels what it knows", () => {
  it("says the sender is unverified on a conversation the inbox recorded", () => {
    view([inboxEntry()]);
    expect(screen.getByText("Automatic")).toBeInTheDocument();
    expect(screen.getByText("Sender unverified")).toBeInTheDocument();
  });

  // A meeting's attendance was observed inside the app: the host built the
  // invite list and the room watched people join. Marking those unverified too
  // would train a reader to ignore the words on the rows where they are true.
  it("does not say it on a meeting the app watched happen", () => {
    view([meetingEntry()]);
    expect(screen.getByText("Automatic")).toBeInTheDocument();
    expect(screen.queryByText("Sender unverified")).toBeNull();
  });

  it("says neither on an entry a person logged by hand", () => {
    view([
      {
        id: "act-hand",
        type: "note",
        direction: null,
        subject: "Called Ana",
        body: "She is in.",
        occurredAt: "2026-09-23T14:00:00.000Z",
        misattributedAt: null,
        misattributionReason: null,
        misattributedByName: null,
        actorId: "principal-1",
        actorName: "Me",
        isSystem: false,
        metadata: {},
      },
    ]);
    expect(screen.queryByText("Automatic")).toBeNull();
    expect(screen.queryByText("Sender unverified")).toBeNull();
  });
});
