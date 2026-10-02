import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoticeStack, type StageNotice } from "./NoticeStack";

const notice = (id: string, priority: number, pinned = false): StageNotice => ({
  id, priority, pinned, node: <p>{id} notice</p>,
});

describe("NoticeStack", () => {
  it("shows the pinned notices and the most urgent other one, and folds the rest", async () => {
    render(<NoticeStack notices={[notice("guest", 10), notice("recording", 95, true), notice("echo", 60)]} />);
    expect(screen.getByText("recording notice")).toBeInTheDocument();
    expect(screen.getByText("echo notice")).toBeInTheDocument();
    expect(screen.queryByText("guest notice")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "1 more notice" }));
    expect(screen.getByText("guest notice")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("guest notice")).not.toBeInTheDocument();
  });

  it("renders nothing with nothing to say", () => {
    const { container } = render(<NoticeStack notices={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
