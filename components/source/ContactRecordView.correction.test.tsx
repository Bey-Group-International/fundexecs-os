/**
 * The correction UI: what an admin can reach, what a member cannot, and what
 * the two actions actually send.
 *
 * #1196 shipped the capability with no surface at all — the DEFINER function,
 * the route and the read-path filters, and no way for a person to reach any of
 * it. This is that surface, and these are the four properties that make it
 * honest rather than decorative.
 *
 * Asserted through the rendered output and the recorded request bodies. NOT
 * against source text: three tests in lib/crm/misattribution.test.ts have
 * already passed by matching the migration's own prose instead of its code, and
 * a regex over a file cannot tell a control from a comment describing one.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ContactRecordView } from "./ContactRecordView";
import type { ContactRecord, TimelineEntry } from "@/lib/network-contact";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: (...a: unknown[]) => refresh(...(a as [])) }),
}));

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

function entry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "act-1",
    type: "meeting",
    direction: null,
    subject: "Dunbar follow-up",
    body: "Walked the pacing.",
    occurredAt: "2026-09-23T14:00:00.000Z",
    actorId: null,
    actorName: null,
    isSystem: true,
    metadata: {},
    misattributedAt: null,
    misattributionReason: null,
    misattributedByName: null,
    ...over,
  };
}

/** Records every fetch so the request BODY can be inspected, not just the URL. */
function captureFetch() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fn = jest.fn(async (url: unknown, init?: { body?: string }) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return calls;
}

function view(timeline: TimelineEntry[], canCorrect: boolean) {
  return render(
    <ContactRecordView
      initial={{ contact: CONTACT, timeline, tasks: [], possibleDuplicates: [] }}
      owners={[]}
      currentUserId="principal-1"
      canDelete={canCorrect}
      canCorrect={canCorrect}
    />,
  );
}

afterEach(() => {
  jest.resetAllMocks();
});

describe("who can reach the correction", () => {
  it("offers it to an admin on a machine-written entry", () => {
    view([entry()], true);
    expect(screen.getByRole("button", { name: /wrong person/i })).toBeInTheDocument();
  });

  /**
   * The function refuses a hand-written entry with 22023 — those have an owner
   * and ordinary edit and delete rights, and routing them through an admin-only
   * path would be a different power. So offering the control there would ship a
   * button whose only possible outcome is a 400.
   */
  it("does not offer it on an entry a person logged by hand", () => {
    view([entry({ isSystem: false, type: "note", actorName: "Sam" })], true);
    expect(screen.queryByRole("button", { name: /wrong person/i })).toBeNull();
  });

  it("does not offer it to a member", () => {
    view([entry()], false);
    expect(screen.queryByRole("button", { name: /wrong person/i })).toBeNull();
  });
});

describe("a corrected entry", () => {
  const corrected = entry({
    id: "act-wrong",
    misattributedAt: "2026-09-30T12:00:00.000Z",
    misattributionReason: "A colleague's address was on the invite",
    misattributedByName: "Dana Reyes",
  });

  // Hidden by default even from the admin who can see it: the record should read
  // as the record, not as the record plus its corrections.
  it("is hidden until the admin asks for it", async () => {
    view([entry({ id: "act-good" }), corrected], true);
    expect(screen.queryByText("Corrected")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /show 1 corrected entry/i }));
    expect(screen.getByText("Corrected")).toBeInTheDocument();
  });

  // Why, and by whom. A correction with neither is indistinguishable from an
  // entry hidden by mistake.
  it("says who corrected it and why", async () => {
    view([corrected], true);
    await userEvent.click(screen.getByRole("button", { name: /show 1 corrected entry/i }));
    expect(screen.getByText(/Dana Reyes/)).toBeInTheDocument();
    expect(screen.getByText(/colleague's address was on the invite/)).toBeInTheDocument();
  });

  /**
   * A member is never offered the toggle — but the stronger guarantee is that
   * the loader never gave them the row, which is asserted on the loader itself
   * in lib/crm/misattribution.test.ts. This covers the component's half: given a
   * corrected row it must not reveal it to a viewer who cannot correct.
   */
  it("is not revealed to a member even if one reaches the component", () => {
    view([corrected], false);
    expect(screen.queryByText("Corrected")).toBeNull();
    expect(screen.queryByRole("button", { name: /show .* corrected/i })).toBeNull();
  });
});

describe("what the actions send", () => {
  it("marking posts an explicit true, with the reason", async () => {
    const calls = captureFetch();
    view([entry({ id: "act-42" })], true);

    await userEvent.click(screen.getByRole("button", { name: /wrong person/i }));
    await userEvent.type(screen.getByLabelText(/why is this the wrong person/i), "Not her meeting");
    await userEvent.click(screen.getByRole("button", { name: /take it off this record/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/network/activities/act-42/correction");
    expect(calls[0].body).toEqual({ misattributed: true, reason: "Not her meeting" });
  });

  /**
   * The route requires a boolean and has no default, so an omitted field is a
   * 400 rather than a restore. Asserted as an exact body, because `false` and
   * `undefined` are the same shape of bug and only one of them works.
   */
  it("restoring posts an explicit false", async () => {
    const calls = captureFetch();
    view([entry({ id: "act-42", misattributedAt: "2026-09-30T12:00:00.000Z" })], true);

    await userEvent.click(screen.getByRole("button", { name: /show 1 corrected entry/i }));
    await userEvent.click(screen.getByRole("button", { name: /restore to the record/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ misattributed: false, reason: null });
  });

  // Optional on purpose: refusing a correction without a stated cause would
  // leave the wrong entry on the record, which is worse than an unexplained fix.
  it("sends null rather than an empty string when no reason is given", async () => {
    const calls = captureFetch();
    view([entry({ id: "act-42" })], true);

    await userEvent.click(screen.getByRole("button", { name: /wrong person/i }));
    await userEvent.click(screen.getByRole("button", { name: /take it off this record/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ misattributed: true, reason: null });
  });
});

/**
 * The correction does two things, and the second is why the page refreshes.
 *
 * flag_network_activity_misattributed marks the row AND recomputes the
 * contact's last_activity_at from the entries that remain. Patching the one
 * entry in local state would leave the header showing a recency the database no
 * longer agrees with — the half-a-fix the function exists to prevent, restored
 * in the UI.
 */
describe("after a correction", () => {
  it("re-reads the record rather than patching the row", async () => {
    captureFetch();
    view([entry({ id: "act-42" })], true);

    await userEvent.click(screen.getByRole("button", { name: /wrong person/i }));
    await userEvent.click(screen.getByRole("button", { name: /take it off this record/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

/**
 * What the refresh has to actually DO.
 *
 * The test above asserts router.refresh() is called. That is a claim about my
 * assumption — that a server re-render reaches the screen — not about what a
 * reader ends up looking at. It does not: useState reads `initial` once, on
 * mount, so fresh props were being dropped and the correction changed nothing
 * visible. CodeRabbit caught it. These two rerender with new server data and
 * assert the rendered result, which is the property that matters.
 */
describe("when the server re-reads the record", () => {
  it("the timeline shows what the server now returns", () => {
    const { rerender } = view([entry({ id: "act-1", subject: "Dunbar follow-up" })], true);
    expect(screen.getByText("Dunbar follow-up")).toBeInTheDocument();

    // What router.refresh() produces: the same component, new props, because
    // the entry was corrected and the server no longer returns it.
    rerender(
      <ContactRecordView
        initial={{
          contact: CONTACT,
          timeline: [entry({ id: "act-2", subject: "Pacing call" })],
          tasks: [],
          possibleDuplicates: [],
        }}
        owners={[]}
        currentUserId="principal-1"
        canDelete
        canCorrect
      />,
    );

    expect(screen.queryByText("Dunbar follow-up")).toBeNull();
    expect(screen.getByText("Pacing call")).toBeInTheDocument();
  });

  // The other half of the correction, and the reason it refreshes rather than
  // patching one row: the RPC moves the contact's last_activity_at too.
  it("the header shows the recency the server recomputed", () => {
    const { rerender } = view([entry()], true);

    rerender(
      <ContactRecordView
        initial={{
          contact: { ...CONTACT, lastActivityAt: "2026-06-01T00:00:00.000Z" },
          timeline: [entry()],
          tasks: [],
          possibleDuplicates: [],
        }}
        owners={[]}
        currentUserId="principal-1"
        canDelete
        canCorrect
      />,
    );

    expect(screen.getByText(/Jun/)).toBeInTheDocument();
  });
});

/**
 * A failed correction keeps the prompt and the reason.
 *
 * correctEntry reports failure rather than throwing, so the form could close on
 * a rejected request — showing an error while discarding what the person had
 * just typed, and looking like it had worked.
 */
describe("when the correction fails", () => {
  it("leaves the prompt open with the reason still in it", async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Only an organization admin can correct an automatic entry" }),
    })) as unknown;

    view([entry({ id: "act-42" })], true);
    await userEvent.click(screen.getByRole("button", { name: /wrong person/i }));

    const field = screen.getByLabelText(/why is this the wrong person/i);
    await userEvent.type(field, "Not her meeting");
    await userEvent.click(screen.getByRole("button", { name: /take it off this record/i }));

    await waitFor(() =>
      expect(screen.getByText(/Only an organization admin/)).toBeInTheDocument(),
    );
    // Still open, still holding what they wrote.
    expect(screen.getByLabelText(/why is this the wrong person/i)).toHaveValue("Not her meeting");
  });
});
