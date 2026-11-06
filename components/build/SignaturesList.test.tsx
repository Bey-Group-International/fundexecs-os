import { render, screen, within } from "@testing-library/react";
import { SignaturesList } from "@/components/build/SignaturesList";
import type { SignatureTask } from "@/lib/data-room-signatures";

const now = new Date("2026-10-10T12:00:00Z");
const t = (id: string, kind: "legacy" | "envelope", roomId: string, roomName: string, over: Partial<SignatureTask> = {}): SignatureTask => ({
  key: `${kind}:${id}`,
  kind,
  id,
  title: `Document ${id}`,
  roomId,
  roomName,
  signerName: "Pat Reader",
  signerEmail: "pat@example.com",
  signedAt: "2026-10-08T12:00:00Z",
  ...over,
});

function setup(tasks: SignatureTask[], canSign = true, currentRoomId = "r1") {
  return render(
    <SignaturesList
      tasks={tasks}
      currentRoomId={currentRoomId}
      canSign={canSign}
      now={now}
      legacyAction={(x) => <button>Counter-sign {x.id}</button>}
      envelopeAction={(x) => <a href={`/envelopes/${x.id}`}>Open {x.id}</a>}
    />,
  );
}

it("says plainly that nothing is waiting", () => {
  setup([]);
  expect(screen.getByTestId("signatures-summary")).toHaveTextContent("Nothing needs your signature.");
  expect(screen.getByText("Nothing is waiting for your signature.")).toBeInTheDocument();
});

it("lists each document with who signed and how long it has waited", () => {
  setup([t("a", "legacy", "r1", "Fund IV Room")]);
  expect(screen.getByText("Document a")).toBeInTheDocument();
  expect(screen.getByText(/Signed by Pat Reader · waiting 2 days/)).toBeInTheDocument();
  expect(screen.getByTestId("signatures-summary")).toHaveTextContent("1 document needs your signature. Across all your data rooms.");
});

it("groups by room with the open room first and labelled", () => {
  setup([t("a", "legacy", "r2", "Fund III Room"), t("b", "envelope", "r1", "Fund IV Room")], true, "r1");
  const headings = screen.getAllByRole("heading", { level: 4 });
  expect(headings[0]).toHaveTextContent("Fund IV Room");
  expect(headings[0]).toHaveTextContent("this room");
  expect(headings[1]).toHaveTextContent("Fund III Room");
});

it("gives a legacy file the counter-sign form and an envelope a link to its signing page", () => {
  setup([t("a", "legacy", "r1", "R"), t("b", "envelope", "r1", "R")]);
  expect(screen.getByRole("button", { name: "Counter-sign a" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open b" })).toHaveAttribute("href", "/envelopes/b");
});

it("shows the list but no actions to someone who cannot sign, and says why", () => {
  setup([t("a", "legacy", "r1", "R")], false);
  expect(screen.getByText("Document a")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Counter-sign/ })).not.toBeInTheDocument();
  expect(screen.getByText(/Only an owner or admin with a confirmed email can counter-sign/)).toBeInTheDocument();
  expect(within(screen.getByTestId("signatures-awaiting")).queryAllByRole("link")).toHaveLength(0);
});

it("shows an error, never an empty list, when the signatures could not be loaded", () => {
  render(
    <SignaturesList
      tasks={[]}
      error="boom"
      currentRoomId="r1"
      canSign
      legacyAction={() => null}
      envelopeAction={() => null}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't load the documents waiting for your signature/);
  expect(screen.queryByText("Nothing is waiting for your signature.")).not.toBeInTheDocument();
});
