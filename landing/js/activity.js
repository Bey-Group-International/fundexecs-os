/*
 * activity.js
 * -----------
 * Data layer for the FundExecs "Live Activity" ticker.
 *
 * Public API:
 *   getChainOfTrustActivity() -> Promise<Array<Entry>>
 *
 * Entry shape:
 *   { initials, role, region, type, value, date }
 *   type ∈ { "Deal Closed", "Capital Allocated", "Check Signed",
 *            "Capital Raised", "Connector Intro", "Acquisition Review" }
 *
 * Strategy:
 *   1. Attempt to fetch from the (future) live Chain-of-Trust endpoint.
 *   2. On ANY failure (network error, non-200, bad shape), fall back to the
 *      bundled seed file at /data/activity.json so the page always renders.
 *
 * This module is framework-free and safe to load with a plain <script>.
 * It attaches `getChainOfTrustActivity` to `window` for use by main.js.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG
  // ---------------------------------------------------------------------------

  // TODO(chain-of-trust): point this at the real, public, read-only activity
  // feed when it ships. It should return JSON in the shape:
  //   { entries: [ { initials, role, region, type, value, date }, ... ] }
  // Until then the fetch below will fail fast and we fall back to the seed.
  const CHAIN_OF_TRUST_ENDPOINT = null; // e.g. 'https://api.fundexecs.com/v1/activity'

  // Relative path so the page works both at the site root and in subpaths.
  const SEED_URL = './data/activity.json';

  // Abort the live attempt quickly so the fallback feels instant.
  const LIVE_TIMEOUT_MS = 3500;

  // Allowed activity types (used to lightly validate incoming data).
  const ALLOWED_TYPES = new Set([
    'Deal Closed',
    'Capital Allocated',
    'Check Signed',
    'Capital Raised',
    'Connector Intro',
    'Acquisition Review'
  ]);

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /** Returns true if `e` looks like a valid activity entry. */
  function isValidEntry(e) {
    return (
      e &&
      typeof e === 'object' &&
      typeof e.initials === 'string' &&
      typeof e.role === 'string' &&
      typeof e.region === 'string' &&
      typeof e.value === 'string' &&
      typeof e.date === 'string' &&
      ALLOWED_TYPES.has(e.type)
    );
  }

  /** Normalize a raw payload (array OR { entries: [] }) into a clean array. */
  function normalize(payload) {
    const list = Array.isArray(payload)
      ? payload
      : payload && Array.isArray(payload.entries)
        ? payload.entries
        : [];
    return list.filter(isValidEntry);
  }

  /** fetch() with a timeout via AbortController. */
  async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Get the activity feed. Tries the live Chain-of-Trust source first, then
   * falls back to the bundled seed. Always resolves to an array (possibly
   * empty) — it never rejects, so callers don't need try/catch.
   */
  async function getChainOfTrustActivity() {
    // 1) Live source (only if configured).
    if (CHAIN_OF_TRUST_ENDPOINT) {
      try {
        const live = normalize(
          await fetchWithTimeout(CHAIN_OF_TRUST_ENDPOINT, LIVE_TIMEOUT_MS)
        );
        if (live.length) return live;
        // Empty/invalid live response → treat as failure and fall through.
      } catch (err) {
        // Swallow and fall back. Logged at debug level only.
        console.debug('[activity] live source unavailable, using seed:', err);
      }
    }

    // 2) Bundled seed fallback.
    try {
      return normalize(await fetchWithTimeout(SEED_URL, LIVE_TIMEOUT_MS));
    } catch (err) {
      console.warn('[activity] seed fetch failed:', err);
      return [];
    }
  }

  // Expose globally for the no-bundler page.
  window.getChainOfTrustActivity = getChainOfTrustActivity;
})();
