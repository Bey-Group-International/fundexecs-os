# Virtual Office — Hourly Enhancement Log

Newest first. One entry per automated run. See `AUTOMATION.md` for the rules.
The next run number is the top entry's number + 1.

---

## Run #1 — 2026-07-30 — Accessibility & code quality

- **Change:** Declared the office as a dark-scheme document. Added
  `color-scheme:dark` to `:root` and `<meta name="color-scheme" content="dark">`
  + `<meta name="theme-color" content="#070c16">` to `<head>` in
    `public/office/map.html`.
- **Why:** Prevents the white flash before CSS paints, tells the browser to
  render native controls (scrollbars, form fields, focus rings) in dark mode so
  they match the UI, and colors the mobile browser chrome to the office
  background. Zero behavioral change.
- **Files:** `public/office/map.html`
- **Verify:** lint / typecheck / test / build — see PR CI.
- **Note:** Run #1 also seeds the automation infrastructure (`AUTOMATION.md`,
  this log) and the rolling draft PR.

