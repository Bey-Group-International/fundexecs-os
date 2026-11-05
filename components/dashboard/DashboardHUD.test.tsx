import { render, screen } from "@testing-library/react";
import { DashboardHUD } from "./DashboardHUD";
import type { DashboardData } from "@/lib/dashboard/types";

const data = {
  approvals: [{}, {}],
  tasks: [{ status: "pending" }, { status: "done" }, { status: "blocked" }],
  automations: [{ enabled: true }, { enabled: false }],
} as unknown as DashboardData;

it("is a single quiet status line with one status dot and no 'live' label", () => {
  render(<DashboardHUD data={data} />);
  expect(screen.getByText("Systems operational")).toBeInTheDocument();
  expect(screen.queryByText(/FundExecs OS live/i)).not.toBeInTheDocument();
  expect(screen.getByText("2 active tasks")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "2 approval gates" })).toHaveAttribute("href", "/grid/review");
  expect(screen.getByRole("link", { name: "1 automation enabled" })).toHaveAttribute("href", "/automations");
});

it("can leave approvals out so the Needs-you strip is the only place they appear", () => {
  render(<DashboardHUD data={data} showApprovals={false} />);
  expect(screen.queryByText(/approval gate/)).not.toBeInTheDocument();
  expect(screen.getByText("2 active tasks")).toBeInTheDocument();
});
