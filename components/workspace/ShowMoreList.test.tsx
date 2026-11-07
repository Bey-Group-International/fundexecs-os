import { fireEvent, render, screen } from "@testing-library/react";
import { ShowMoreList } from "@/components/workspace/ShowMoreList";

const rows = (n: number) => Array.from({ length: n }, (_, i) => <p key={i}>Session {i + 1}</p>);

it("shows every row and no button when there are no more than the first ten", () => {
  render(<ShowMoreList items={rows(10)} />);
  expect(screen.getAllByText(/^Session \d+$/)).toHaveLength(10);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("shows the first ten of a longer list, in order, with a button naming the total", () => {
  render(<ShowMoreList items={rows(37)} />);
  const shown = screen.getAllByText(/^Session \d+$/);
  expect(shown).toHaveLength(10);
  expect(shown[0]).toHaveTextContent("Session 1");
  expect(shown[9]).toHaveTextContent("Session 10");
  expect(screen.queryByText("Session 11")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show all 37 sessions" })).toHaveAttribute("aria-expanded", "false");
});

it("opens the rest on request and folds them away again", () => {
  render(<ShowMoreList items={rows(12)} />);
  fireEvent.click(screen.getByRole("button", { name: "Show all 12 sessions" }));
  expect(screen.getAllByText(/^Session \d+$/)).toHaveLength(12);
  const fewer = screen.getByRole("button", { name: "Show fewer sessions" });
  expect(fewer).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(fewer);
  expect(screen.getAllByText(/^Session \d+$/)).toHaveLength(10);
});

it("points the button at the list it controls", () => {
  const { container } = render(<ShowMoreList items={rows(15)} />);
  const button = screen.getByRole("button");
  const id = button.getAttribute("aria-controls")!;
  expect(container.querySelector(`[id="${id}"]`)).toBeInTheDocument();
});

it("honours a different first count and noun", () => {
  render(<ShowMoreList items={rows(8)} initial={5} noun="deals" />);
  expect(screen.getAllByText(/^Session \d+$/)).toHaveLength(5);
  expect(screen.getByRole("button", { name: "Show all 8 deals" })).toBeInTheDocument();
});
