// lib/security-headers.cjs
// The response headers the app sets. CommonJS so that next.config.mjs can import
// it and tests can require it: the config file can't import TypeScript.
//
// Two layers. Everything gets the site-wide set. The public investor pages under
// /lp/ get a stricter one, because their URL is a bearer token: whoever holds the
// link can reach the page, so the link must not leak (Referer, caches, search
// indexes) and the page must not be framed or have its forms pointed at another site.

/** Site-wide. These were in next.config.mjs before; HSTS is new. */
const SITE_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
  // A year, this host only: no includeSubDomains (other subdomains are not this
  // app's to commit) and no preload (a list that is hard to leave).
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

/** The /lp/ policy with a given script-src, and any extra directives. Everything else is the same in every variant. */
function lpPolicy(scriptSrc, extra = []) {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...extra,
  ].join("; ");
}

/**
 * The policy for /lp/. The investor pages load nothing from another origin: fonts
 * are self-hosted at build time, there are no remote images, and a hosted ID
 * verification is a navigation to Stripe, not an embed. So everything is
 * 'self', and the page cannot be framed or load plugins, and its <base> and
 * form targets cannot point at another origin. ('self' is the same origin, not
 * the same path: a form posting to a different page of this site is allowed.)
 *
 * 'unsafe-inline' remains for scripts and styles: Next.js writes inline script
 * tags to hydrate the page, and removing the allowance needs a per-request nonce
 * from the proxy. So this stops anything loaded from another origin, framing,
 * and a <base> or form target on another origin. It is not a defence against injected inline script.
 * In development React also needs eval for its debugging, so it is allowed there only.
 */
function lpContentSecurityPolicy({ dev = false } = {}) {
  return lpPolicy(`'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`);
}

/** Where the browser posts what the nonce policy below would have blocked. */
const LP_CSP_REPORT_PATH = "/api/csp-report";

/**
 * The same policy with the one change that closes the gap above: scripts need this
 * request's nonce (Next.js adds it to its own inline scripts when the request carries a
 * policy that names one) instead of 'unsafe-inline'. It is sent REPORT-ONLY: the browser
 * enforces the policy above and only reports what this one would have blocked, to
 * LP_CSP_REPORT_PATH, so it can be checked against real pages before it is enforced.
 * `strict-dynamic` lets a nonced script load the chunks it needs.
 */
function lpNonceReportOnlyPolicy(nonce, { dev = false } = {}) {
  return lpPolicy(`'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`, [`report-uri ${LP_CSP_REPORT_PATH}`]);
}

/** Whether a path is one of the investor pages. */
function isLpPath(pathname) {
  return pathname === "/lp" || pathname.startsWith("/lp/");
}

/** For /lp/ only. Each of these replaces the site-wide value of the same name. */
function lpHeaders({ dev = false } = {}) {
  return [
    { key: "Content-Security-Policy", value: lpContentSecurityPolicy({ dev }) },
    // The link is the credential: send it nowhere as a Referer, not even to Stripe.
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Frame-Options", value: "DENY" },
    // Nothing on these pages uses the camera, microphone or location.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    // A page reached by a bearer link is not kept by a shared cache or a browser's back-forward store.
    { key: "Cache-Control", value: "private, no-store" },
    // And a link that leaks into a search engine is a credential in a search result.
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  ];
}

/**
 * The rules for next.config's headers(). The /lp/ rule is declared after the
 * site-wide one so it is the later of two matches for the same key, which is the
 * one Next.js applies.
 */
function securityHeaderRules({ dev = false } = {}) {
  return [
    { source: "/(.*)", headers: SITE_HEADERS },
    { source: "/lp/:path*", headers: lpHeaders({ dev }) },
  ];
}

module.exports = { SITE_HEADERS, lpHeaders, lpContentSecurityPolicy, lpNonceReportOnlyPolicy, isLpPath, LP_CSP_REPORT_PATH, securityHeaderRules };
