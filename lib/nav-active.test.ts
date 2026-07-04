import { navHrefActive } from "./nav-active";

describe("navHrefActive", () => {
  it("matches exact and nested canonical routes", () => {
    expect(navHrefActive("/source/lp_pipeline", "/source/lp_pipeline")).toBe(true);
    expect(navHrefActive("/source/lp_pipeline/detail", "/source/lp_pipeline")).toBe(true);
    expect(navHrefActive("/source/deal_pipeline", "/source/lp_pipeline")).toBe(false);
    // sibling-prefix collision: href must match on a path-segment boundary
    expect(navHrefActive("/source/lp_pipeline_extended", "/source/lp_pipeline")).toBe(false);
    expect(navHrefActive("/source/lp_pipeline", "/source/lp")).toBe(false);
  });

  it("matches session-scoped hub module routes against canonical hrefs", () => {
    expect(navHrefActive("/session/s1/source/lp_pipeline", "/source/lp_pipeline")).toBe(true);
    expect(navHrefActive("/session/s1/source/lp_pipeline/detail", "/source/lp_pipeline")).toBe(true);
    expect(navHrefActive("/session/s1/run/diligence", "/source/lp_pipeline")).toBe(false);
  });
});
