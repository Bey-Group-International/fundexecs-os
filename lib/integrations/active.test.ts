import { getActiveIntegrations } from "@/lib/integrations/active";

// The adapters read process.env at call time, so toggling a credential var
// flips a channel between mock mode and Connected for these assertions.
describe("getActiveIntegrations", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("lists only channels with real credentials, labeled for display", () => {
    delete process.env.DOCUSIGN_ACCESS_TOKEN;
    delete process.env.DOCUSIGN_INTEGRATION_KEY;
    expect(getActiveIntegrations().some((i) => i.channel === "docusign")).toBe(false);

    process.env.DOCUSIGN_ACCESS_TOKEN = "token";
    const active = getActiveIntegrations();
    const docusign = active.find((i) => i.channel === "docusign");
    expect(docusign?.label).toBe("Docusign");
  });

  it("exposes each connected channel's operational capabilities from its dispatch handles", () => {
    process.env.DOCUSIGN_ACCESS_TOKEN = "token";
    const docusign = getActiveIntegrations().find((i) => i.channel === "docusign");
    const kinds = docusign?.capabilities.map((c) => c.kind) ?? [];
    expect(kinds).toEqual(expect.arrayContaining(["sign_document", "submit_term_sheet"]));
    // Docusign actions are capital-binding (Tier 3) — the gate tier rides along.
    const sign = docusign?.capabilities.find((c) => c.kind === "sign_document");
    expect(sign).toMatchObject({ label: "Sign document", tier: 3, tierLabel: "Capital-binding" });
  });

  it("returns a distinct channel only once even if multiple modules share it", () => {
    const channels = getActiveIntegrations().map((i) => i.channel);
    expect(channels.length).toBe(new Set(channels).size);
  });
});
