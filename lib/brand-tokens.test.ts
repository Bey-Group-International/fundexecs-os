import { readFileSync } from "node:fs";
import path from "node:path";
import { BRAND, THEME_COLOR } from "@/lib/site";
import manifest from "@/app/manifest";

/*
 * lib/site.ts's BRAND is hand-maintained hex that mirrors CSS custom properties
 * it cannot read. That mirror had gone stale — BRAND still described the old
 * dark/gold theme long after the app moved to the light palette — and because
 * the web app manifest derives its splash and chrome colors from it, every cold
 * launch of the installed PWA flashed a near-black splash before painting a
 * light UI. Nothing failed, so nothing caught it. These tests are the mirror's
 * missing check.
 */

const ROOT = path.join(__dirname, "..");

function cssVar(name: string): string {
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
  // First declaration wins — the `:root` block sits at the top of the file.
  const match = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!match) throw new Error(`token ${name} not found in app/globals.css`);
  return match[1].trim();
}

/** "240 245 252" -> "#F0F5FC" */
function tripletToHex(triplet: string): string {
  const parts = triplet.split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`expected an "R G B" triplet, got "${triplet}"`);
  }
  return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

describe("BRAND mirrors the live design tokens", () => {
  const cases: ReadonlyArray<[keyof typeof BRAND, string]> = [
    ["background", "--fx-surface-0"],
    ["fg", "--fx-fg-primary"],
    ["fgMuted", "--fx-fg-muted"],
    ["gold", "--fx-gold-rgb"],
    ["goldLight", "--fx-gold-500"],
  ];

  it.each(cases)("BRAND.%s matches %s", (field, token) => {
    expect(BRAND[field].toUpperCase()).toBe(tripletToHex(cssVar(token)));
  });
});

describe("installed-app launch colors", () => {
  it("paints the splash and app chrome in the color the page actually renders", () => {
    const m = manifest();
    expect(m.background_color).toBe(THEME_COLOR);
    expect(m.theme_color).toBe(THEME_COLOR);
    expect(THEME_COLOR).toBe(tripletToHex(cssVar("--fx-surface-0")));
  });

  it("keeps the root layout's viewport themeColor on the same shared constant", () => {
    // Read as source: importing app/layout.tsx here would pull in next/font and
    // a stylesheet. All this needs to catch is the value being re-hardcoded and
    // drifting away from the manifest again.
    const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/themeColor:\s*THEME_COLOR/);
  });
});
