import {
  virtualOfficeRoutes,
  LEGACY_VIRTUAL_OFFICE_PREFIX,
  legacyToVirtualOffice,
  characterStudioAvatar,
  spaceEditorSpace,
} from "./virtualOfficeRoutes";

describe("virtualOfficeRoutes", () => {
  it("roots every surface under /virtual-office", () => {
    expect(virtualOfficeRoutes.root).toBe("/virtual-office");
    for (const path of Object.values(virtualOfficeRoutes)) {
      expect(path.startsWith("/virtual-office")).toBe(true);
    }
  });

  it("keeps Command Center as an inner surface, not the umbrella route", () => {
    expect(virtualOfficeRoutes.commandCenter).toBe("/virtual-office/command-center");
  });

  it("builds dynamic avatar / space routes", () => {
    expect(characterStudioAvatar("av_123")).toBe("/virtual-office/character-studio/av_123");
    expect(spaceEditorSpace("sp_9")).toBe("/virtual-office/space-editor/sp_9");
  });
});

describe("legacyToVirtualOffice — legacy Command Center URLs resolve correctly", () => {
  it("redirects the bare path", () => {
    expect(legacyToVirtualOffice("/command-center")).toBe("/virtual-office");
  });

  it("preserves nested segments", () => {
    expect(legacyToVirtualOffice("/command-center/character-studio/library")).toBe(
      "/virtual-office/character-studio/library",
    );
  });

  it("preserves the query string (room / meet / deal / invite deep links)", () => {
    expect(legacyToVirtualOffice("/command-center?room=boardroom&meet=1")).toBe(
      "/virtual-office?room=boardroom&meet=1",
    );
    expect(legacyToVirtualOffice("/command-center?room=trading&deal=abc-123&invite=tok_1")).toBe(
      "/virtual-office?room=trading&deal=abc-123&invite=tok_1",
    );
  });

  it("preserves nested path + query together", () => {
    expect(legacyToVirtualOffice("/command-center/space-editor/sp_1?tab=publish")).toBe(
      "/virtual-office/space-editor/sp_1?tab=publish",
    );
  });

  it("preserves a hash fragment", () => {
    expect(legacyToVirtualOffice("/command-center?room=ceo#desk")).toBe(
      "/virtual-office?room=ceo#desk",
    );
  });

  it("does not match unrelated or look-alike paths", () => {
    expect(legacyToVirtualOffice("/dashboard")).toBeNull();
    expect(legacyToVirtualOffice("/command-center-legacy")).toBeNull();
    expect(legacyToVirtualOffice("/virtual-office")).toBeNull();
  });

  it("exposes the legacy prefix it heals", () => {
    expect(LEGACY_VIRTUAL_OFFICE_PREFIX).toBe("/command-center");
  });
});
