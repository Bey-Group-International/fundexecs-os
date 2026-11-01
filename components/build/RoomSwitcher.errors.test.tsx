const createRoom = jest.fn();
jest.mock("./room-actions", () => ({ createRoom: (...a: unknown[]) => createRoom(...a), renameRoom: jest.fn(), archiveRoom: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => "/build/data_room" }));

import { render, screen, fireEvent } from "@testing-library/react";
import { RoomSwitcher } from "./RoomSwitcher";

const room = { id: "r1", name: "Primary Data Room", description: null, isDefault: true };

it("keeps the new-room form open, with what was typed, when creating fails", async () => {
  createRoom.mockRejectedValue(new Error("redacted"));
  render(<RoomSwitcher rooms={[room]} current={room} />);
  fireEvent.click(screen.getByText("+ New room"));
  fireEvent.change(screen.getByPlaceholderText(/Room name/), { target: { value: "Fund III Raise" } });
  fireEvent.click(screen.getByText("Create room"));
  expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't create the room/);
  expect(screen.getByPlaceholderText(/Room name/)).toHaveValue("Fund III Raise");
});
