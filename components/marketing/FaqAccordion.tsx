type FaqItem = { question: string; answer: string };

type FaqAccordionProps = {
  items: FaqItem[];
  className?: string;
};

// Accessible FAQ accordion built on native <details>/<summary> — no client JS,
// keyboard-operable for free, and it degrades to open content if scripting is
// off. Also emits FAQPage JSON-LD so the questions are eligible for rich
// results. Styled in the fx surface/gold system with a chevron that rotates
// via the `group-open` state.
export function FaqAccordion({ items, className = "" }: FaqAccordionProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`.trim()}>
      <script
        type="application/ld+json"
        // Server-rendered; content is our own static copy, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {items.map((item) => (
        <details
          key={item.question}
          className="fx-card group px-5 py-1 [&_summary::-webkit-details-marker]:hidden"
        >
          <summary className="fx-focus flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-base font-medium text-fg-primary">
            {item.question}
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4 shrink-0 text-gold-400 transition-transform duration-200 group-open:rotate-180"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <p className="pb-4 text-sm leading-relaxed text-fg-secondary">
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
