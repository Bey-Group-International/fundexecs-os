// Central schema.org / JSON-LD builders. This is the FundExecs OS equivalent of
// the global JSON-LD `@graph` a marketing SPA hand-writes in index.html — except
// it is typed, derives every value from lib/site.ts (single source of truth), and
// omits any field we cannot back with real data.
//
// Identity model: FundExecs OS is a SaaS product, so it is described as a
// `SoftwareApplication` published by an `Organization`, tied together with a
// `WebSite` node via stable `@id` references so search engines and LLM crawlers
// treat them as one entity graph.

import {
  SITE_CONTACT_EMAIL,
  SITE_DESCRIPTION,
  SITE_LOGO,
  SITE_LOGO_SIZE,
  SITE_NAME,
  SITE_SOCIALS,
  SITE_TAGLINE,
  SITE_URL,
} from "@/lib/site";

// Stable node identifiers. Keeping these as fragment URLs lets other pages
// reference the same organization/website without redefining it.
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const SOFTWARE_ID = `${SITE_URL}/#software`;

type JsonLdNode = Record<string, unknown>;

/** Drop keys whose value is undefined, null, or an empty array. */
function compact<T extends JsonLdNode>(node: T): T {
  return Object.fromEntries(
    Object.entries(node).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  ) as T;
}

export function organizationSchema(): JsonLdNode {
  return compact({
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: SITE_LOGO,
      width: SITE_LOGO_SIZE,
      height: SITE_LOGO_SIZE,
    },
    description: SITE_DESCRIPTION,
    slogan: SITE_TAGLINE,
    // Omitted entirely when SITE_SOCIALS is empty (see compact()).
    sameAs: [...SITE_SOCIALS],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SITE_CONTACT_EMAIL,
      availableLanguage: ["English"],
    },
  });
}

export function websiteSchema(): JsonLdNode {
  return compact({
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    publisher: { "@id": ORG_ID },
    inLanguage: "en-US",
  });
}

export function softwareApplicationSchema(): JsonLdNode {
  return compact({
    "@type": "SoftwareApplication",
    "@id": SOFTWARE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    publisher: { "@id": ORG_ID },
    // No `offers` node: pricing is not public, and inventing a price would be
    // both wrong and flagged by Google's Rich Results validator.
  });
}

/**
 * The global entity graph injected once from the root layout. Mirrors the
 * "Global JSON-LD Schema" block a marketing site places in <head>, but built
 * from typed nodes.
 */
export function globalGraph(): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationSchema(),
      websiteSchema(),
      softwareApplicationSchema(),
    ],
  };
}

/**
 * Per-page WebPage node. Call from a route's generateMetadata companion or
 * render a <JsonLd> with this to give a specific URL its own indexable node,
 * linked back to the global organization/website.
 */
export function webPageSchema(input: {
  path: string;
  name: string;
  description?: string;
}): JsonLdNode {
  const url = `${SITE_URL}${input.path.startsWith("/") ? "" : "/"}${input.path}`;
  return compact({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: input.name,
    description: input.description,
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
    inLanguage: "en-US",
  });
}

/**
 * BreadcrumbList builder for nested pages. Pass ordered crumbs; the last item
 * is typically the current page.
 */
export function breadcrumbSchema(
  items: Array<{ name: string; path: string }>,
): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path.startsWith("/") ? "" : "/"}${item.path}`,
    })),
  };
}
