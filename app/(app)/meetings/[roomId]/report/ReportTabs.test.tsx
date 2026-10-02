import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReportTabs } from "./ReportTabs";
import { reportTabs } from "@/lib/meetings/report-tabs";

const tabs = reportTabs({
  hasFollowUp: true,
  followUpBadge: "Draft",
  hasRecording: true,
  hasTranscript: true,
  chatCount: 2,
  actionItemCount: 1,
});

function setup() {
  render(
    <ReportTabs
      tabs={tabs}
      panels={{
        overview: <p>Summary text</p>,
        "follow-up": <textarea aria-label="Draft" defaultValue="Hi all" />,
        media: <p>Transcript text</p>,
        chat: <p>Chat text</p>,
      }}
      aside={<p>Participants card</p>}
    />,
  );
}

const panelOf = (text: string) => screen.getByText(text).closest('[role="tabpanel"]') as HTMLElement;

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("ReportTabs", () => {
  it("opens on the overview, with the others hidden but mounted", () => {
    setup();
    expect(screen.getByRole("tab", { name: /overview/i })).toHaveAttribute("aria-selected", "true");
    expect(panelOf("Summary text").className).toContain("block");
    expect(panelOf("Transcript text").className).toContain("hidden");
  });

  it("switches on a click and writes the tab into the URL", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /chat/i }));
    expect(screen.getByRole("tab", { name: /chat/i })).toHaveAttribute("aria-selected", "true");
    expect(window.location.hash).toBe("#chat");
    expect(panelOf("Chat text").className).not.toContain("hidden");
  });

  it("opens the tab a link asks for", () => {
    window.history.replaceState(null, "", "/#follow-up");
    setup();
    expect(screen.getByRole("tab", { name: /follow-up/i })).toHaveAttribute("aria-selected", "true");
  });

  it("follows a hash change from an in-page link", () => {
    setup();
    act(() => {
      window.history.replaceState(null, "", "/#transcript");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("tab", { name: /recording & transcript/i })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps a half-edited draft through a tab switch", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /follow-up/i }));
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Hi all, edited" } });
    fireEvent.click(screen.getByRole("tab", { name: /chat/i }));
    fireEvent.click(screen.getByRole("tab", { name: /follow-up/i }));
    expect(screen.getByLabelText("Draft")).toHaveValue("Hi all, edited");
  });

  it("shows the details as their own tab on a narrow screen only", () => {
    setup();
    const details = screen.getByRole("tab", { name: /details/i });
    expect(details.className).toContain("lg:hidden");
    fireEvent.click(details);
    expect(panelOf("Participants card").className).toMatch(/(^|\s)flex(\s|$)/);
    // The overview stays up beside them where the sidebar is visible.
    expect(panelOf("Summary text").className).toContain("lg:block");
  });

  it("moves between tabs with the arrow keys", () => {
    setup();
    const overview = screen.getByRole("tab", { name: /overview/i });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /follow-up/i })).toHaveAttribute("aria-selected", "true");
  });
});
