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
    expect(docusign).toEqual({ channel: "docusign", label: "Docusign" });
  });

  it("returns a distinct channel only once even if multiple modules share it", () => {
    const channels = getActiveIntegrations().map((i) => i.channel);
    expect(channels.length).toBe(new Set(channels).size);
  });
});
