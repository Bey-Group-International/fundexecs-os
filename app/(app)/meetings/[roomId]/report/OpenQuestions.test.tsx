/**
 * The questions a report asks when the transcript could not settle something.
 *
 * Worth a test: the questions are shown to everyone, only the host can answer,
 * the answers reach the regenerate route paired with their questions, a
 * question left blank is not sent as an empty answer, and the page re-reads
 * the report afterwards.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { OpenQuestions } from "./OpenQuestions";

const QUESTIONS = [
  "Did Jane commit to the $10M re-up, or only to reviewing the terms?",
  "Who owns sending the updated deck?",
];

function captureFetch(response: { ok?: boolean; json?: unknown } = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: unknown, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: response.ok ?? true, json: async () => response.json ?? {} } as unknown as Response;
    },
  );
  return calls;
}

afterEach(() => jest.clearAllMocks());

it("renders nothing when there is nothing to ask", () => {
  const { container } = render(<OpenQuestions meetingId="m1" questions={[]} isHost />);
  expect(container).toBeEmptyDOMElement();
});

it("shows the questions to someone who is not the host, without a way to answer", () => {
  render(<OpenQuestions meetingId="m1" questions={QUESTIONS} isHost={false} />);
  expect(screen.getByText("2 questions to complete this report")).toBeInTheDocument();
  expect(screen.getByText(QUESTIONS[0])).toBeInTheDocument();
  expect(screen.getByText(/The host can answer them/)).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("sends the host's answers, paired with their questions, and re-reads the page", async () => {
  const calls = captureFetch();
  render(<OpenQuestions meetingId="m1" questions={QUESTIONS} isHost />);

  const button = screen.getByRole("button", { name: /Update report with answers/ });
  expect(button).toBeDisabled();

  await userEvent.type(screen.getByLabelText(QUESTIONS[0]), "Jane committed $10M.");
  expect(screen.getByRole("button", { name: "Update report with 1 answer" })).toBeEnabled();
  await userEvent.type(screen.getByLabelText(QUESTIONS[1]), "Mark owns the deck.");
  await userEvent.click(screen.getByRole("button", { name: "Update report with answers" }));

  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(calls).toEqual([
    {
      url: "/api/meetings/m1/report/regenerate",
      method: "POST",
      body: {
        correction:
          `Q: ${QUESTIONS[0]}\nA: Jane committed $10M.\n\n` +
          `Q: ${QUESTIONS[1]}\nA: Mark owns the deck.`,
      },
    },
  ]);
  expect(screen.getByRole("status")).toHaveTextContent(/Updating the report with your answers/);
});

it("leaves an unanswered question out rather than sending a blank answer", async () => {
  const calls = captureFetch();
  render(<OpenQuestions meetingId="m1" questions={QUESTIONS} isHost />);
  await userEvent.type(screen.getByLabelText(QUESTIONS[1]), "Mark.");
  await userEvent.click(screen.getByRole("button", { name: "Update report with 1 answer" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].body).toEqual({ correction: `Q: ${QUESTIONS[1]}\nA: Mark.` });
});

it("says so when the route refuses, and does not re-read the page", async () => {
  captureFetch({ ok: false, json: { error: "Only the host can correct this report." } });
  render(<OpenQuestions meetingId="m1" questions={QUESTIONS} isHost />);
  await userEvent.type(screen.getByLabelText(QUESTIONS[0]), "Yes.");
  await userEvent.click(screen.getByRole("button", { name: "Update report with 1 answer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only the host can correct this report.");
  expect(refresh).not.toHaveBeenCalled();
});
