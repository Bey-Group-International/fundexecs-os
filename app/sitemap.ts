import type { MetadataRoute } from 'next';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.fundexecs.com').replace(
  /\/$/,
  ''
);

/**
 * sitemap.xml (App Router metadata route). Public routes only; authenticated
 * surfaces are disallowed in robots.ts. Trimmed to the home route while the new
 * frontend is rebuilt.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1
    }
  ];
}
