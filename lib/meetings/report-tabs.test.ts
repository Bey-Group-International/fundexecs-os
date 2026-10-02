import { reportTabs, tabFromHash, tabHash } from "./report-tabs";

const everything = {
  hasFollowUp: true,
  followUpBadge: "Draft",
  hasRecording: true,
  hasTranscript: true,
  chatCount: 3,
  actionItemCount: 4,
};

describe("reportTabs", () => {
  it("offers a tab for each part the meeting has, in reading order", () => {
    expect(reportTabs(everything).map((t) => t.id)).toEqual(["overview", "follow-up", "media", "chat", "details"]);
  });

  it("leaves out the parts a meeting does not have", () => {
    const bare = reportTabs({ ...everything, hasFollowUp: false, hasRecording: false, hasTranscript: false, chatCount: 0 });
    expect(bare.map((t) => t.id)).toEqual(["overview", "details"]);
  });

  it("calls it a transcript when there was no recording", () => {
    const media = reportTabs({ ...everything, hasRecording: false }).find((t) => t.id === "media");
    expect(media?.label).toBe("Transcript");
  });

  it("puts counts and the follow-up state on the tabs", () => {
    const tabs = reportTabs(everything);
    expect(tabs.find((t) => t.id === "overview")?.badge).toBe("4");
    expect(tabs.find((t) => t.id === "follow-up")?.badge).toBe("Draft");
    expect(tabs.find((t) => t.id === "chat")?.badge).toBe("3");
  });

  it("keeps Details to narrow screens, where the sidebar is not beside the report", () => {
    expect(reportTabs(everything).find((t) => t.id === "details")?.narrowOnly).toBe(true);
  });
});

describe("tabFromHash", () => {
  const all = reportTabs(everything).map((t) => t.id);

  it("opens the tab a link names, including the older anchors", () => {
    expect(tabFromHash("#follow-up", all)).toBe("follow-up");
    expect(tabFromHash("#transcript", all)).toBe("media");
    expect(tabFromHash("#recording", all)).toBe("media");
    expect(tabFromHash("#CHAT", all)).toBe("chat");
  });

  it("falls back to the overview for anything else, or a tab this report lacks", () => {
    expect(tabFromHash("", all)).toBe("overview");
    expect(tabFromHash("#nonsense", all)).toBe("overview");
    expect(tabFromHash("#follow-up", ["overview", "details"])).toBe("overview");
  });

  it("round-trips through the hash a tab writes", () => {
    for (const tab of all) expect(tabFromHash(`#${tabHash(tab)}`, all)).toBe(tab);
  });
});
