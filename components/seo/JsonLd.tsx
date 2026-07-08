// Renders a JSON-LD <script> the Next.js-native way. Unlike a marketing SPA
// that hand-writes <script type="application/ld+json"> in index.html, this is a
// server component: the JSON is serialized on the server and streamed in the
// initial HTML, so crawlers (Googlebot, GPTBot, ClaudeBot, PerplexityBot …) see
// it without executing any JavaScript.
//
// Usage:
//   import { JsonLd } from "@/components/seo/JsonLd";
//   import { globalGraph } from "@/lib/seo/structured-data";
//   <JsonLd id="ld-global" data={globalGraph()} />

type JsonLdProps = {
  data: Record<string, unknown> | Array<Record<string, unknown>>;
  /** Stable id so React can key the node and it stays deduplicated. */
  id?: string;
};

// Escape "<" to prevent a "</script>" sequence inside string values from
// prematurely closing the tag — the standard, safe way to embed JSON in HTML.
function serialize(data: JsonLdProps["data"]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function JsonLd({ data, id }: JsonLdProps) {
  return (
    <script
      id={id}
      type="application/ld+json"
      // Content is derived from typed builders in lib/seo, never user input.
      dangerouslySetInnerHTML={{ __html: serialize(data) }}
    />
  );
}
