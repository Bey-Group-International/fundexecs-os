import { toChatTurns } from "@/lib/session-messages";

describe("toChatTurns", () => {
  it("maps assistant rows to Earn turns and user rows to You turns, with timestamps", () => {
    const turns = toChatTurns([
      { id: "1", role: "user", content: "What's a good DSCR?", created_at: "2026-06-22T13:00:00Z" },
      { id: "2", role: "assistant", content: "For stabilized multifamily, 1.25x+.", created_at: "2026-06-22T13:00:05Z" },
    ]);
    expect(turns).toEqual([
      { id: "1", role: "you", content: "What's a good DSCR?", ts: Date.parse("2026-06-22T13:00:00Z") },
      { id: "2", role: "earn", content: "For stabilized multifamily, 1.25x+.", ts: Date.parse("2026-06-22T13:00:05Z") },
    ]);
  });

  it("returns an empty list for no rows", () => {
    expect(toChatTurns([])).toEqual([]);
  });
});
