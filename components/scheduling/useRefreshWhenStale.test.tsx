import { act, renderHook } from "@testing-library/react";
import { SLOTS_STALE_MS, useRefreshWhenStale } from "./useRefreshWhenStale";

let now = 1_000_000;
beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

function comeBack() {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

it("does nothing when the tab returns while the data is fresh", () => {
  const refresh = jest.fn();
  renderHook(() => useRefreshWhenStale(refresh));
  now += SLOTS_STALE_MS - 1;
  comeBack();
  expect(refresh).not.toHaveBeenCalled();
});

it("reloads once when the tab returns after the data went stale", () => {
  const refresh = jest.fn();
  renderHook(() => useRefreshWhenStale(refresh));
  now += SLOTS_STALE_MS;
  // A tab switch fires both events; that is still one reload.
  comeBack();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("counts from the last successful load, not from mount", () => {
  const refresh = jest.fn();
  const { result } = renderHook(() => useRefreshWhenStale(refresh));
  now += SLOTS_STALE_MS - 1000;
  result.current();
  now += 2000;
  comeBack();
  expect(refresh).not.toHaveBeenCalled();
});

it("holds off while disabled, e.g. mid-submit", () => {
  const refresh = jest.fn();
  renderHook(() => useRefreshWhenStale(refresh, { enabled: false }));
  now += SLOTS_STALE_MS * 2;
  comeBack();
  expect(refresh).not.toHaveBeenCalled();
});
