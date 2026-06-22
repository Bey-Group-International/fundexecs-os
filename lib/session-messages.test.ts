import { toChatTurns } from "@/lib/session-messages";

describe("toChatTurns", () => {
  it("maps assistant rows to Earn turns and user rows to You turns, in order", () => {
    const turns = toChatTurns([
      { id: "1", role: "user", content: "What's a good DSCR?" },
      { id: "2", role: "assistant", content: "For stabilized multifamily, 1.25x+." },
    ]);
    expect(turns).toEqual([
      { id: "1", role: "you", content: "What's a good DSCR?" },
      { id: "2", role: "earn", content: "For stabilized multifamily, 1.25x+." },
    ]);
  });

  it("returns an empty list for no rows", () => {
    expect(toChatTurns([])).toEqual([]);
  });
});
