'use client';

import Link from 'next/link';
import Markdown from 'react-markdown';
import type { ComponentPropsWithoutRef } from 'react';

/**
 * EarnMarkdown — renders Earn's replies as markdown (lists, bold, code, links)
 * inside the chat bubble. Internal links (paths starting with `/`, e.g.
 * `/diligence/123`) become client-side `next/link` navigations; external links
 * open in a new tab. Tight, token-styled to sit in the assistant bubble.
 */
export function EarnMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-[12.5px] leading-relaxed [&_code]:rounded [&_code]:bg-bg-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11.5px] [&_li]:ml-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:font-semibold [&_strong]:text-fg-1 [&_ul]:list-disc [&_ul]:pl-4">
      <Markdown
        components={{
          a({ href, children, ...props }: ComponentPropsWithoutRef<'a'> & { href?: string }) {
            const target = href ?? '';
            if (target.startsWith('/')) {
              return (
                <Link
                  href={target}
                  className="font-medium text-gold-1 underline-offset-2 hover:underline"
                >
                  {children}
                </Link>
              );
            }
            return (
              <a
                href={target}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-gold-1 underline-offset-2 hover:underline"
                {...props}
              >
                {children}
              </a>
            );
          },
          p({ children }) {
            return <p className="whitespace-pre-wrap">{children}</p>;
          }
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

export default EarnMarkdown;
