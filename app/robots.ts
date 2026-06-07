import type { MetadataRoute } from 'next';

/**
 * robots.ts — disallow all crawlers during private beta.
 *
 * FundExecs OS is invite-only; we don't want search engines indexing
 * authenticated surfaces, stub routes, or API endpoints. The sitemap
 * is still declared so it's easy to flip to `allow` when we go public.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/'
      }
    ],
    sitemap: 'https://www.fundexecs.com/sitemap.xml'
  };
}
