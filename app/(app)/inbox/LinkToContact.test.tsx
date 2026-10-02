/**
 * Linking an inbox thread to a contact by hand: nothing fetched until asked,
 * the newest search wins, and the link is the thread id posted to the
 * contact's links route.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinkToContact } from "./LinkToContact";

const ANA = { id: "c-ana", fullName: "Ana Lopez", email: "ana@acme.com", company: "Acme" };

// A plain object rather than `Response`, which this jsdom environment lacks.
function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn((url: string) =>
    url.startsWith("/api/network/search") ? json({ results: [ANA] }) : json({ entry: { id: "a1" } }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
});

async function openAndSearch(text = "ana") {
  const user = userEvent.setup();
  render(<LinkToContact threadId="t-1" counterparty="ana.l@gmail.com" />);
  await user.click(screen.getByRole("button", { name: "Link to contact" }));
  await user.type(screen.getByLabelText("Search contacts"), text);
  return user;
}

describe("LinkToContact", () => {
  it("fetches nothing until someone opens it and types", async () => {
    const user = userEvent.setup();
    render(<LinkToContact threadId="t-1" counterparty="x" />);
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Link to contact" }));
    await user.type(screen.getByLabelText("Search contacts"), "a");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches the CRM and links the thread to the chosen contact", async () => {
    const user = await openAndSearch();
    const option = await screen.findByRole("option", { name: /Ana Lopez/ });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/network/search?q=ana&limit=8");
    await user.click(option);

    await waitFor(() => expect(screen.getByText(/Linked to Ana Lopez/)).toBeTruthy());
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/network/contacts/c-ana/links");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ threadId: "t-1" });
    expect(screen.getByRole("link", { name: "Open record →" }).getAttribute("href")).toBe("/network/c-ana");
  });

  it("treats an existing link as done", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.startsWith("/api/network/search") ? json({ results: [ANA] }) : json({ error: "Already linked" }, 409),
    );
    const user = await openAndSearch();
    await user.click(await screen.findByRole("option", { name: /Ana Lopez/ }));
    await waitFor(() => expect(screen.getByText(/Linked to Ana Lopez/)).toBeTruthy());
  });

  it("keeps the picker open and says why when the link fails", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.startsWith("/api/network/search") ? json({ results: [ANA] }) : json({ error: "Contact not found" }, 404),
    );
    const user = await openAndSearch();
    await user.click(await screen.findByRole("option", { name: /Ana Lopez/ }));
    expect(await screen.findByText("Contact not found")).toBeTruthy();
    expect(screen.getByLabelText("Search contacts")).toBeTruthy();
  });

  it("says when nothing matches", async () => {
    fetchMock.mockImplementation(() => json({ results: [] }));
    await openAndSearch("zz");
    expect(await screen.findByText("No contacts match.")).toBeTruthy();
  });
});
