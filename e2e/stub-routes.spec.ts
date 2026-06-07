import { test, expect } from '@playwright/test';

/**
 * Stub→real route wiring.
 *
 * Several rail entries are thin `redirect()` pages that forward to the real
 * shipped surface. We assert the stub actually forwards (it does NOT stay on
 * the stub path) and lands on the expected destination/login chain.
 *
 * These run UNAUTHENTICATED. The real destinations are auth-gated, so the chain
 * is: stub → real route → auth gate → /login. We therefore assert:
 *   1. We never sit on the stub path (the redirect fired), and
 *   2. We end up on the real destination OR its /login gate.
 *
 * `expectsRedirectedFrom` captures destinations that are gated by the shared
 * middleware (which preserves `?redirectedFrom=<dest>`); destinations gated at
 * the page level redirect to a bare /login, so we don't assert the param there.
 */

const STUB_REDIRECTS: {
  from: string;
  to: string;
  /** True when the destination is middleware-gated (preserves redirectedFrom). */
  expectsRedirectedFrom: boolean;
}[] = [
  // deal-desk, ic-memos, governance, and knowledge are now real surfaces (not
  // stubs), so their redirect assertions were removed. Only the entries below
  // remain thin redirects.
  { from: '/action-queue', to: '/notifications', expectsRedirectedFrom: true }
];

for (const { from, to, expectsRedirectedFrom } of STUB_REDIRECTS) {
  test(`${from} forwards to ${to} (unauth → login chain)`, async ({ page }) => {
    await page.goto(from, { waitUntil: 'domcontentloaded' });

    // The destination lands either on the real route (if somehow public) or on
    // its /login gate. Either way we MUST have left the stub path.
    await expect(page).toHaveURL(new RegExp(`/login(\\?|$)|${to.replace(/\//g, '\\/')}(\\?|$|/)`));

    const url = new URL(page.url());
    expect(url.pathname, 'stub redirect must have fired (not still on stub)').not.toBe(from);

    // When middleware gated the destination, it preserves the REAL destination
    // as redirectedFrom — proving the stub forwarded before the gate, not the
    // stub path itself.
    if (expectsRedirectedFrom && url.pathname === '/login') {
      expect(url.searchParams.get('redirectedFrom')).toBe(to);
    }
  });
}
