import { buildLlmsFullTxt } from "@/lib/seo/llms";

// Served at /llms-full.txt — expanded, concatenated context for RAG ingestion.
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildLlmsFullTxt(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
