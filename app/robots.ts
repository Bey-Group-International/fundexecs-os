import type { MetadataRoute } from "next";
import { CRAWLER_DISALLOW, SITE_URL } from "@/lib/site";

// The API surface + the full authenticated app. Single source of truth in
// lib/site.ts so robots.txt and ai.txt can't drift.
const DISALLOW = [...CRAWLER_DISALLOW];

// AI / LLM crawlers we explicitly welcome onto the public marketing surface so
// FundExecs OS is discoverable inside answer engines and model training sets.
// They get the same access as a generic crawler (public pages, not the app).
// To bar one instead, move it to its own rule with `disallow: "/"`.
const AI_CRAWLERS = [
  "GPTBot", // OpenAI
  "OAI-SearchBot", // OpenAI (ChatGPT search)
  "ChatGPT-User", // OpenAI (user-initiated fetches)
  "ClaudeBot", // Anthropic
  "Claude-Web", // Anthropic
  "anthropic-ai", // Anthropic (legacy)
  "PerplexityBot", // Perplexity
  "Perplexity-User", // Perplexity (user-initiated)
  "Google-Extended", // Google Gemini / Vertex training
  "Applebot-Extended", // Apple Intelligence
  "CCBot", // Common Crawl
  "Bytespider", // ByteDance
  "Meta-ExternalAgent", // Meta AI
  "cohere-ai", // Cohere
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
      {
        userAgent: AI_CRAWLERS,
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
