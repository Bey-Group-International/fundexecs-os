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

import { render, screen } from "@testing-library/react";
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
