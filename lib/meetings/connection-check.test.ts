import { connectionVerdict, medianMs } from "./connection-check";

it("takes the middle sample and ignores failures", () => {
  expect(medianMs([300, 40, 60])).toBe(60);
  expect(medianMs([40, 60])).toBe(50);
  expect(medianMs([Number.NaN, 80])).toBe(80);
  expect(medianMs([Number.NaN])).toBeNull();
});

it("grades the connection and says what to do", () => {
  expect(connectionVerdict(48, true)).toEqual({ quality: "good", label: "Good (48 ms)", advice: null });
  expect(connectionVerdict(300, true).quality).toBe("fair");
  expect(connectionVerdict(80, true, "3g").quality).toBe("fair");
  expect(connectionVerdict(700, true).quality).toBe("poor");
  expect(connectionVerdict(50, true, "2g").advice).toMatch(/camera off/);
  expect(connectionVerdict(50, false).quality).toBe("offline");
  expect(connectionVerdict(null, true).quality).toBe("offline");
});
