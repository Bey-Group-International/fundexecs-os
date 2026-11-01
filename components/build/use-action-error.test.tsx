import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActionError, useActionError } from "./use-action-error";

function Harness({ action }: { action: () => Promise<unknown> }) {
  const { error, run } = useActionError();
  return (
    <div>
      <button onClick={() => void run(action, "Couldn't do it. Try again.")}>go</button>
      <ActionError message={error} />
    </div>
  );
}

describe("useActionError", () => {
  it("shows the caller's message when the action rejects, instead of throwing", async () => {
    render(<Harness action={() => Promise.reject(new Error("redacted"))} />);
    fireEvent.click(screen.getByText("go"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't do it. Try again.");
  });

  it("clears the message when a later attempt succeeds", async () => {
    const action = jest.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(undefined);
    render(<Harness action={action} />);
    fireEvent.click(screen.getByText("go"));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("reports success so the caller can keep or undo its optimistic state", async () => {
    let result: boolean | undefined;
    function Probe() {
      const { run } = useActionError();
      return <button onClick={async () => (result = await run(() => Promise.reject(new Error("x")), "m"))}>p</button>;
    }
    render(<Probe />);
    fireEvent.click(screen.getByText("p"));
    await waitFor(() => expect(result).toBe(false));
  });
});
