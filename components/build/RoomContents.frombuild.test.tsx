jest.mock("./room-actions", () => ({
  unpublishDocument: jest.fn(),
  publishDocument: jest.fn(),
  moveRoomDocument: jest.fn(),
  setDocumentSignature: jest.fn(),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { RoomContents } from "./RoomContents";
import { buildContentRows } from "@/lib/data-rooms";

const src = { tagline: "Culture, Capital, and Control", thesisTitle: "Lower mid-market credit", dealCount: 0, weightedGrossIrr: null, teamCount: 2, entityCount: 0 };

describe("the From Build rows in Room contents", () => {
  it("lists what a reader sees from Build, each with where it appears and a link to edit it", () => {
    render(<RoomContents roomId="r1" sections={[]} available={[]} fromBuild={buildContentRows(src)} />);
    expect(screen.getByText(/From Build/)).toBeInTheDocument();
    expect(screen.getByText("Lower mid-market credit")).toBeInTheDocument();
    expect(screen.getByText("Under Investment Strategy & Thesis")).toBeInTheDocument();
    expect(screen.getByText("Under Track Record & Performance")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Edit in Build →" })[0]).toHaveAttribute("href", "/build/profile");
  });

  it("points an empty Build module at the place to fill it in", () => {
    render(<RoomContents roomId="r1" sections={[]} available={[]} fromBuild={buildContentRows(src)} />);
    expect(screen.getByText("No deals entered yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add in Build →" })).toHaveAttribute("href", "/build/track_record");
  });

  it("is absent when no rows are passed", () => {
    render(<RoomContents roomId="r1" sections={[]} available={[]} />);
    expect(screen.queryByText(/From Build/)).not.toBeInTheDocument();
  });
});

describe("the Preview button on a published document", () => {
  const doc = { id: "d1", name: "Deck", status: "ready" as const, hasBody: true, isLink: false, requireSignature: false, signers: [] };

  it("asks for that document in the preview", () => {
    const onPreview = jest.fn();
    render(<RoomContents roomId="r1" sections={[{ key: "marketing", label: "Marketing", docs: [doc] }]} available={[]} onPreview={onPreview} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onPreview).toHaveBeenCalledWith("d1");
  });

  it("is absent when no handler is given", () => {
    render(<RoomContents roomId="r1" sections={[{ key: "marketing", label: "Marketing", docs: [doc] }]} available={[]} />);
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });
});

describe("when Build cannot be read", () => {
  it("says so, rather than showing nothing as though nothing came from Build", () => {
    render(<RoomContents roomId="r1" sections={[]} available={[]} fromBuildUnavailable />);
    expect(screen.getByRole("status")).toHaveTextContent(/Couldn't load what Build contributes/);
  });

  it("labels the rows by what a link allows, not as shown to every reader", () => {
    render(<RoomContents roomId="r1" sections={[]} available={[]} fromBuild={buildContentRows(src)} />);
    expect(screen.getByText(/shown where a link allows the section/)).toBeInTheDocument();
    expect(screen.queryByText(/every reader/)).toBeNull();
  });
});
