/**
 * The one line the component tests and the loader tests both miss.
 *
 * loadContactRecord is tested: it filters corrected entries unless asked not
 * to. ContactRecordView is tested: it offers the correction only to a viewer
 * who may make it. Neither can see the seam BETWEEN them — this page deciding,
 * from the caller's role, whether to ask for the corrected rows at all.
 *
 * That seam is the security-relevant part. Changing
 * `{ includeCorrected: canCorrect }` to `{ includeCorrected: true }` hands every
 * member of the organisation the entries an admin took off the record, which
 * makes the correction cosmetic. Injected before writing this file: all 7,888
 * tests still passed. That is why this file exists.
 *
 * The page is an async server component, so each case awaits it and renders
 * what it returned, following meetings/[roomId]/report/page.test.tsx.
 */
import React from "react";
import { render, screen } from "@testing-library/react";

const getSessionContext = jest.fn();
const loadContactRecord = jest.fn();

jest.mock("@/lib/auth", () => ({
  getSessionContext: () => getSessionContext(),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({}) as unknown,
}));
jest.mock("@/lib/network-audit", () => ({
  recordNetworkAudit: async () => {},
}));
jest.mock("@/lib/network-contact", () => ({
  loadContactRecord: (...args: unknown[]) => loadContactRecord(...args),
  loadPrincipalNames: async () => new Map<string, string>(),
  LOGGABLE_TYPES: [],
}));

// A marker that reports exactly what the page handed the view, so the prop is
// read rather than inferred from what happens to render.
jest.mock("@/components/source/ContactRecordView", () => ({
  ContactRecordView: ({ canCorrect }: { canCorrect: boolean }) => (
    <div data-testid="view" data-can-correct={String(canCorrect)} />
  ),
}));

import ContactPage from "./page";

const VIEW = {
  contact: { id: "contact-ana", fullName: "Ana Diaz" },
  timeline: [],
  tasks: [],
  possibleDuplicates: [],
};

async function renderFor(role: string) {
  getSessionContext.mockResolvedValue({ orgId: "org-1", userId: "p1", role });
  loadContactRecord.mockResolvedValue(VIEW);
  const ui = await ContactPage({ params: Promise.resolve({ id: "contact-ana" }) });
  render(ui as React.ReactElement);
  return loadContactRecord.mock.calls.at(-1);
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("who the page asks for corrected entries on behalf of", () => {
  // The same right flag_network_activity_misattributed checks for itself.
  it.each(["owner", "admin"])("asks for them when the viewer is an %s", async (role) => {
    const call = await renderFor(role);
    expect(call?.[3]).toMatchObject({ includeCorrected: true });
    expect(screen.getByTestId("view")).toHaveAttribute("data-can-correct", "true");
  });

  /**
   * A member must receive neither the rows nor the action. The rows matter more:
   * an action they cannot perform is only a broken button, but a corrected entry
   * appearing on an ordinary reader's record means the correction did nothing.
   */
  it.each(["member", "viewer"])("does not ask for them when the viewer is a %s", async (role) => {
    const call = await renderFor(role);
    expect(call?.[3]).toMatchObject({ includeCorrected: false });
    expect(screen.getByTestId("view")).toHaveAttribute("data-can-correct", "false");
  });

  // An unrecognised role reads as "not an admin" rather than as an error, so a
  // role added later is excluded until somebody decides it should not be.
  it("treats an unknown role as not permitted", async () => {
    const call = await renderFor("auditor");
    expect(call?.[3]).toMatchObject({ includeCorrected: false });
    expect(screen.getByTestId("view")).toHaveAttribute("data-can-correct", "false");
  });
});
