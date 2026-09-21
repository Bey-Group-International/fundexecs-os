import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileEarnHome } from "./MobileEarnHome";
import type { CommandCenterData } from "./MobileCommandCenter";

const push = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const data: CommandCenterData = {
  name: "Alex Partner",
  greeting: "Morning",
  dateLabel: "Sep 21",
  counts: { deals: 12, approvals: 3, workflows: 4, unread: 7 },
  nextAction: {
    eyebrow: "Next best action",
    title: "Approve the LP update",
    href: "/approvals",
    cta: "Review",
  },
  approvals: [],
  workflows: [],
  deals: [],
  activity: [],
};

describe("MobileEarnHome", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("renders labelled live-pulse stats for small mobile layouts", () => {
    render(<MobileEarnHome data={data} />);

    expect(screen.getByText("Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Approvals")).toBeInTheDocument();
    expect(screen.getByText("Workflows")).toBeInTheDocument();
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    expect(screen.getByText("waiting")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("keeps the Earn composer wired to the mobile ask flow", async () => {
    const user = userEvent.setup();
    render(<MobileEarnHome data={data} />);

    await user.type(screen.getByLabelText("Message Earn"), "Check approvals");
    await user.click(screen.getByRole("button", { name: "Send to Earn" }));

    expect(push).toHaveBeenCalledWith("/earn?ask=Check%20approvals");
  });
});
