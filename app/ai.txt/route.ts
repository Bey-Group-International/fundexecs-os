import { buildAiTxt } from "@/lib/seo/llms";

// Served at /ai.txt — AI training & usage policy.
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildAiTxt(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
