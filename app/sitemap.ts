import type { MetadataRoute } from 'next';

const BASE = 'https://www.fundexecs.com';

/**
 * sitemap.ts — public-facing routes only (legal + landing).
 *
 * Authenticated app surfaces are excluded; they require a session and
 * should not be indexed. The sitemap is declared in robots.ts but all
 * crawlers are currently disallowed during private beta — this file is
 * ready to expand when the product opens publicly.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1
    },
    {
      url: `${BASE}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3
    },
    {
      url: `${BASE}/terms`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3
    }
  ];
}
