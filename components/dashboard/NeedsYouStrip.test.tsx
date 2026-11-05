import { render, screen } from "@testing-library/react";
import { NeedsYouStrip } from "./NeedsYouStrip";

const none = { count: 0, oldestDays: 0 };

it("says so when nothing needs the operator", () => {
  render(<NeedsYouStrip approvals={0} staleDeals={none} readinessNext={null} />);
  expect(screen.getByText("Nothing needs you right now.")).toBeInTheDocument();
  expect(screen.queryAllByRole("link")).toHaveLength(0);
});

it("links each waiting item straight to its list", () => {
  render(
    <NeedsYouStrip
      approvals={2}
      staleDeals={{ count: 3, oldestDays: 41 }}
      readinessNext={{ label: "Add your thesis", href: "/build/profile#thesis" }}
    />,
  );
  expect(screen.getByRole("link", { name: /2 approvals waiting/ })).toHaveAttribute("href", "/grid/review");
  expect(screen.getByRole("link", { name: /3 deals gone quiet/ })).toHaveAttribute("href", "/source/deal_pipeline");
  expect(screen.getByText("Oldest 41 days")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Add your thesis/ })).toHaveAttribute("href", "/build/profile#thesis");
});

it("uses singular wording for one item", () => {
  render(<NeedsYouStrip approvals={1} staleDeals={{ count: 1, oldestDays: 15 }} readinessNext={null} />);
  expect(screen.getByText("1 approval waiting")).toBeInTheDocument();
  expect(screen.getByText("1 deal gone quiet")).toBeInTheDocument();
});

it("shows a plus when the approval count is only a floor", () => {
  render(<NeedsYouStrip approvals={5} approvalsCapped staleDeals={none} readinessNext={null} />);
  expect(screen.getByText("5+ approvals waiting")).toBeInTheDocument();
});

it("leaves out items that are zero", () => {
  render(<NeedsYouStrip approvals={0} staleDeals={{ count: 2, oldestDays: 20 }} readinessNext={null} />);
  expect(screen.queryByText(/approval/)).not.toBeInTheDocument();
  expect(screen.getByText("2 deals gone quiet")).toBeInTheDocument();
});
