import { act, fireEvent, render, screen } from "@testing-library/react";
import { IntakeQuestionsEditor, draftsToQuestions } from "./IntakeQuestionsEditor";

it("adds a suggested question in one tap and saves the cleaned list", async () => {
  const onSave = jest.fn(async () => true);
  render(<IntakeQuestionsEditor questions={[]} busy={false} onSave={onSave} onClose={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "+ Company or fund" }));
  fireEvent.click(screen.getByRole("button", { name: "+ Add question" }));
  fireEvent.change(screen.getByLabelText("Question 2"), { target: { value: "Ticket size" } });
  fireEvent.change(screen.getByLabelText("Answer type for question 2"), { target: { value: "choice" } });
  fireEvent.change(screen.getByLabelText("Choices for question 2"), { target: { value: "<$1m, $1-5m, >$5m" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save questions" }));
  });

  expect(onSave).toHaveBeenCalledWith([
    { id: "company-or-fund", label: "Company or fund", kind: "short", options: [], required: true },
    { id: "question", label: "Ticket size", kind: "choice", options: ["<$1m", "$1-5m", ">$5m"], required: false },
  ]);
  expect(await screen.findByText("Saved.")).toBeTruthy();
});

it("reorders and removes questions", () => {
  render(
    <IntakeQuestionsEditor
      questions={[
        { id: "a", label: "First", kind: "short", options: [], required: false },
        { id: "b", label: "Second", kind: "short", options: [], required: false },
      ]}
      busy={false}
      onSave={async () => true}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Move question 2 up" }));
  expect((screen.getByLabelText("Question 1") as HTMLInputElement).value).toBe("Second");
  fireEvent.click(screen.getByRole("button", { name: "Remove question 1" }));
  expect((screen.getByLabelText("Question 1") as HTMLInputElement).value).toBe("First");
});

it("drops blank questions when saving", () => {
  expect(draftsToQuestions([{ id: "x", label: " ", kind: "short", optionsText: "", required: true }])).toEqual([]);
});
