import { skillAutoInvokeEnabledFor } from "./config";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("skillAutoInvokeEnabledFor", () => {
  it("is off for everyone by default", () => {
    expect(skillAutoInvokeEnabledFor(A, {})).toBe(false);
    expect(skillAutoInvokeEnabledFor(null, {})).toBe(false);
    expect(skillAutoInvokeEnabledFor(A, { SKILL_AUTOINVOKE_ENABLED: "yes" })).toBe(false); // only the literal "true" counts
  });

  it("turns on for exactly the listed orgs (case and whitespace tolerant)", () => {
    const env = { SKILL_AUTOINVOKE_ORGS: ` ${A.toUpperCase()} , ` };
    expect(skillAutoInvokeEnabledFor(A, env)).toBe(true);
    expect(skillAutoInvokeEnabledFor(B, env)).toBe(false);
    expect(skillAutoInvokeEnabledFor(undefined, env)).toBe(false);
  });

  it("the global flag turns it on for every org", () => {
    expect(skillAutoInvokeEnabledFor(B, { SKILL_AUTOINVOKE_ENABLED: "true" })).toBe(true);
  });

  it("an empty allow-list matches nothing, not everything", () => {
    expect(skillAutoInvokeEnabledFor(A, { SKILL_AUTOINVOKE_ORGS: "" })).toBe(false);
    expect(skillAutoInvokeEnabledFor("", { SKILL_AUTOINVOKE_ORGS: "," })).toBe(false);
  });
});
