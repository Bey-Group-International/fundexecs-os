import { buildLlmsTxt } from "@/lib/seo/llms";

// Served at /llms.txt — the short AI-crawler context index.
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildLlmsTxt(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
