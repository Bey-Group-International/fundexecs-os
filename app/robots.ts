import type { MetadataRoute } from 'next';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.fundexecs.com').replace(
  /\/$/,
  ''
);

/**
 * robots.txt (App Router metadata route).
 *
 * The marketing/public surface is crawlable; every authenticated app route is
 * disallowed so the private workspace never leaks into search indexes. Kept in
 * sync with the rail's authed surfaces — add new authed prefixes here when they
 * ship.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login', '/privacy', '/terms'],
        disallow: [
          '/command-center',
          '/pipeline',
          '/diligence',
          '/connections',
          '/settings',
          '/admin',
          '/strategy',
          '/lp-room',
          '/profile',
          '/notifications',
          '/onboarding',
          '/ask-earn',
          '/audit',
          '/capital-stack',
          '/partners',
          '/match-inbox',
          '/objections',
          '/integrations',
          '/materials',
          '/inbox-intelligence',
          '/dashboard',
          '/action-queue',
          '/deal-desk',
          '/governance',
          '/ic-memos',
          '/knowledge',
          '/trust'
        ]
      }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
