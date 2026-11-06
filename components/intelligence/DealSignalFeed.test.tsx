import { render, screen } from "@testing-library/react";
import { DealSignalFeed } from "./DealSignalFeed";
import type { DealSignal } from "@/lib/deal-intelligence";

const signal = (id: string, over: Partial<DealSignal> = {}): DealSignal => ({
  id,
  signalType: "pipeline_deal",
  title: `Deal ${id}`,
  relevanceScore: 0,
  thesisMatchScore: 0,
  publishedAt: "2026-10-12T09:00:00Z",
  ...over,
});

it("draws no thesis-fit badge for a signal that has no score", () => {
  render(<DealSignalFeed signals={[signal("1"), signal("2")]} />);
  expect(screen.queryByText(/thesis fit/i)).not.toBeInTheDocument();
});

it("still shows the badge for a signal that really has a score", () => {
  render(<DealSignalFeed signals={[signal("1", { signalType: "funding_round", thesisMatchScore: 72 })]} />);
  expect(screen.getByText("72% thesis fit")).toBeInTheDocument();
});

it("labels a pipeline deal as 'Your pipeline', never as a funding round", () => {
  render(<DealSignalFeed signals={[signal("1")]} />);
  expect(screen.getAllByText(/Your pipeline/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/funding round/i)).not.toBeInTheDocument();
});
