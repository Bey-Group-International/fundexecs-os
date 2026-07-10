import {
  DEFAULT_EXEC_CONFIG,
  resolveExecConfig,
  loadTeamConfig,
  saveTeamConfig,
  countCustomized,
  TEAM_CONFIG_KEY,
  type TeamConfig,
  type TeamConfigStorage,
} from "./teamConfig";

function memStorage(seed?: Record<string, string>): TeamConfigStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("teamConfig — resolveExecConfig", () => {
  it("returns the defaults for an executive with no override", () => {
    expect(resolveExecConfig("analyst", {})).toEqual(DEFAULT_EXEC_CONFIG);
  });

  it("merges an override over the defaults", () => {
    const cfg: TeamConfig = { risk: { enabled: true, provider: "openai", humanInLoop: true, gateTier: "capital_binding" } };
    expect(resolveExecConfig("risk", cfg)).toEqual({
      enabled: true,
      provider: "openai",
      humanInLoop: true,
      gateTier: "capital_binding",
    });
  });
});

describe("teamConfig — load/save", () => {
  it("round-trips a saved config through storage", () => {
    const store = memStorage();
    const cfg: TeamConfig = { legal: { enabled: false, provider: "google", humanInLoop: true, gateTier: "external_facing" } };
    saveTeamConfig(cfg, store);
    expect(loadTeamConfig(store)).toEqual(cfg);
  });

  it("returns an empty config when nothing is saved", () => {
    expect(loadTeamConfig(memStorage())).toEqual({});
  });

  it("ignores malformed JSON", () => {
    expect(loadTeamConfig(memStorage({ [TEAM_CONFIG_KEY]: "not json" }))).toEqual({});
  });

  it("sanitizes an unknown provider / tier back to defaults", () => {
    const store = memStorage({
      [TEAM_CONFIG_KEY]: JSON.stringify({ analyst: { enabled: true, provider: "skynet", humanInLoop: true, gateTier: "nuclear" } }),
    });
    const loaded = loadTeamConfig(store);
    expect(loaded.analyst?.provider).toBe(DEFAULT_EXEC_CONFIG.provider);
    expect(loaded.analyst?.gateTier).toBe(DEFAULT_EXEC_CONFIG.gateTier);
    expect(loaded.analyst?.humanInLoop).toBe(true); // valid fields are kept
  });
});

describe("teamConfig — countCustomized", () => {
  it("counts only executives that differ from the defaults", () => {
    const cfg: TeamConfig = {
      analyst: { ...DEFAULT_EXEC_CONFIG }, // unchanged
      risk: { ...DEFAULT_EXEC_CONFIG, humanInLoop: true }, // changed
      legal: { ...DEFAULT_EXEC_CONFIG, enabled: false }, // changed
    };
    expect(countCustomized(cfg)).toBe(2);
  });
});
