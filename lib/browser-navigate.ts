// lib/browser-navigate.ts
// A full-page navigation to another site. Wrapped so a test can see where the
// browser would have gone: jsdom doesn't allow window.location to be replaced.
export function goTo(url: string): void {
  window.location.assign(url);
}
