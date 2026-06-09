'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { NAV_CTA } from '@/components/landing/cta';

/**
 * LandingNav — the public marketing nav. Sticky; gains a subtle backdrop blur
 * and hairline once the page is scrolled, mirroring the authenticated app
 * topbar (`AppShell` Topbar). State is set inside the scroll handler / async
 * continuation, never synchronously in the effect body.
 */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    // Initial state on the next frame (avoids set-state-in-effect lint).
    const raf = requestAnimationFrame(onScroll);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 border-b transition-[background,backdrop-filter,border-color] duration-200',
        scrolled
          ? 'border-hairline bg-[var(--topbar-bg)] backdrop-blur-md'
          : 'border-transparent bg-transparent'
      )}
    >
      <nav
        className="mx-auto flex h-[60px] max-w-[1180px] items-center justify-between px-5 sm:px-8"
        aria-label="Primary"
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
          aria-label="FundExecs OS home"
        >
          <EarnCoin size={26} />
          <span className="text-base font-semibold tracking-[-0.02em] text-fg-1">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </span>
        </Link>
        <div className="flex items-center gap-4 sm:gap-5">
          <Link
            href="/login"
            className="rounded-md text-sm font-medium text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
          >
            Sign in
          </Link>
          <Link href="/login" className={NAV_CTA}>
            Get started
            <ArrowRight size={15} strokeWidth={1.9} aria-hidden />
          </Link>
        </div>
      </nav>
    </header>
  );
}

export default LandingNav;
