const unpublishDocument = jest.fn();
const publishDocument = jest.fn();
jest.mock("./room-actions", () => ({
  unpublishDocument: (...a: unknown[]) => unpublishDocument(...a),
  publishDocument: (...a: unknown[]) => publishDocument(...a),
  moveRoomDocument: jest.fn(),
  setDocumentSignature: jest.fn(),
}));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { render, screen, fireEvent } from "@testing-library/react";
import { RoomContents } from "./RoomContents";

const doc = { id: "d1", name: "Deck", status: "ready" as const, hasBody: true, isLink: false, requireSignature: false, signers: [] };

describe("room action failures", () => {
  beforeEach(() => jest.clearAllMocks());

  it("says so next to the row when withdrawing a document fails", async () => {
    unpublishDocument.mockRejectedValue(new Error("redacted"));
    render(<RoomContents roomId="r1" sections={[{ key: "marketing", label: "Marketing", docs: [doc] }]} available={[]} />);
    fireEvent.click(screen.getByText("Remove"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still be visible/i);
    // The page is still there: the row did not disappear into an error boundary.
    expect(screen.getByText("Deck")).toBeInTheDocument();
  });

  it("undoes the optimistic 'Published' when publishing fails, so it can be retried", async () => {
    publishDocument.mockRejectedValue(new Error("redacted"));
    render(
      <RoomContents
        roomId="r1"
        sections={[]}
        available={[{ id: "a1", name: "Teaser", sectionLabel: "Marketing", status: "ready" }]}
      />,
    );
    fireEvent.click(screen.getByText(/Publish from library/));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't publish/i);
    expect(screen.getByRole("button", { name: "Publish" })).not.toBeDisabled();
  });
});
