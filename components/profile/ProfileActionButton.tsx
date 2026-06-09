'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Link2,
  PenLine,
  Share2,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react';
import { Badge } from '@/components/ui';
import { Drawer } from '@/components/drawers/Drawer';
import { cn } from '@/lib/utils';
import { MEMBER_TYPE_LABELS } from '@/lib/member-types';
import { createProfileShareLink } from '@/lib/actions/profile-share';
import type { FundProfile, ProfileSection } from '@/lib/queries/fund-profile';

const ONBOARDING = '/onboarding';
/** General edit intent — clears the middleware's post-publish onboarding bounce. */
const EDIT = `${ONBOARDING}?edit=1`;

function toneForScore(score: number): { color: string; bg: string; label: string } {
  if (score >= 75) return { color: 'var(--success)', bg: 'var(--success-soft)', label: 'Strong' };
  if (score >= 50) return { color: 'var(--accent)', bg: 'var(--accent-soft)', label: 'Solid' };
  if (score >= 25) return { color: 'var(--warning)', bg: 'var(--warning-soft)', label: 'Building' };
  return { color: 'var(--danger)', bg: 'var(--danger-soft)', label: 'Gap' };
}

/** Primary label by completeness — the headline state of the button. */
function primaryLabel(score: number): string {
  if (score >= 100) return 'Review profile';
  if (score > 0) return 'Resume profile';
  return 'Start profile';
}

/** Deep-link to onboarding focused on a specific gap (forward-compatible hint). */
function gapHref(field: string): string {
  return `${ONBOARDING}?focus=${encodeURIComponent(field)}`;
}

export interface ProfileActionButtonProps {
  profile: FundProfile;
  /** `hero` = full gradient CTA; `compact` = bordered pill for rails/dashboard. */
  variant?: 'hero' | 'compact';
  className?: string;
}

/**
 * ProfileActionButton — the reactive "Review profile" control.
 *
 * State-aware: the primary label tracks completeness (Start → Resume → Review),
 * and the primary action is mixed by state — at 100% it opens an in-place
 * read-only review Drawer; below 100% it routes into the onboarding editor to
 * keep building. A split caret opens a menu of context-aware quick actions:
 * review on the record, jump to the top open gaps (deep-linked into onboarding),
 * edit in onboarding, and copy a revocable public share link (/p/&lt;token&gt;).
 *
 * a11y mirrors AccountMenu/Drawer: the caret carries aria-haspopup/expanded; the
 * popover is a labeled menu with click-outside, Esc, and arrow-key navigation;
 * the Drawer traps focus and restores it on close. Reduced-motion safe.
 */
export function ProfileActionButton({
  profile,
  variant = 'hero',
  className
}: ProfileActionButtonProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'pending' | 'copied' | 'error'>('idle');

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const score = profile.completenessScore;
  const tone = toneForScore(score);
  const label = primaryLabel(score);
  const topGaps = profile.gaps.slice(0, 3);
  const isReview = score >= 100;

  const openReview = useCallback(() => {
    setMenuOpen(false);
    setDrawerOpen(true);
  }, []);

  // Primary action is mixed by state: review-in-place at 100%, else open the
  // builder focused on the highest-priority gap (the work that compounds most),
  // falling back to a general edit when there's no specific gap.
  const onPrimary = useCallback(() => {
    if (isReview) {
      openReview();
      return;
    }
    router.push(topGaps[0] ? gapHref(topGaps[0].field) : EDIT);
  }, [isReview, openReview, router, topGaps]);

  // Mint (or reuse) the public share link and copy it. Reactive state feeds the
  // menu label so the click resolves to a clear "Link copied" / error inline.
  const onShare = useCallback(() => {
    setShareState('pending');
    const reset = () => window.setTimeout(() => setShareState('idle'), 2200);
    createProfileShareLink()
      .then((res) => {
        if (!res.ok) {
          setShareState('error');
          reset();
          return;
        }
        const writePromise = navigator.clipboard?.writeText?.(res.url);
        if (!writePromise) {
          setShareState('error');
          reset();
          return;
        }
        void writePromise.then(
          () => {
            setShareState('copied');
            reset();
          },
          () => {
            setShareState('error');
            reset();
          }
        );
      })
      .catch(() => {
        setShareState('error');
        reset();
      });
  }, []);

  // Click-outside + Esc close the menu (mirrors AccountMenu).
  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current && !wrapRef.current.contains(t)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        caretRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Focus first item on open.
  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>('[data-menu-item]')?.focus();
  }, [menuOpen]);

  // Arrow-key navigation across menu items.
  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? []
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const dir = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
    let next = i;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else next = (i + dir + items.length) % items.length;
    items[next]?.focus();
  }

  const hero = variant === 'hero';

  return (
    <div
      ref={wrapRef}
      className={cn('relative inline-flex flex-col items-start', className)}
      data-testid="profile-action-button"
    >
      <div className="inline-flex items-stretch">
        {/* Primary */}
        <button
          type="button"
          onClick={onPrimary}
          data-testid="profile-action-primary"
          className={cn(
            'group inline-flex items-center gap-1.5 font-semibold transition-[transform,filter,background,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]',
            hero
              ? 'rounded-l-xl bg-[var(--cta-gradient)] px-3.5 py-2 text-[12.5px] text-white shadow-[var(--shadow-cta)] hover:brightness-110'
              : 'rounded-l-lg border border-r-0 border-hairline bg-bg-1 px-2.5 py-1.5 text-[11.5px] text-fg-1 hover:bg-surface-1'
          )}
        >
          {!hero ? <MiniRing score={score} color={tone.color} /> : null}
          {label}
          {isReview ? (
            <ShieldCheck size={hero ? 13 : 12} strokeWidth={2} aria-hidden />
          ) : (
            <ArrowRight
              size={hero ? 13 : 12}
              strokeWidth={2}
              aria-hidden
              className="transition-transform group-hover:translate-x-0.5"
            />
          )}
        </button>

        {/* Split caret */}
        <button
          ref={caretRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-label="More profile actions"
          data-testid="profile-action-caret"
          className={cn(
            'inline-flex items-center justify-center transition-[transform,filter,background] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]',
            hero
              ? 'rounded-r-xl border-l border-white/25 bg-[var(--cta-gradient)] px-2 py-2 text-white shadow-[var(--shadow-cta)] hover:brightness-110'
              : 'rounded-r-lg border border-hairline bg-bg-1 px-1.5 py-1.5 text-fg-3 hover:bg-surface-1'
          )}
        >
          <ChevronDown
            size={hero ? 14 : 13}
            strokeWidth={2}
            aria-hidden
            className={cn('transition-transform', menuOpen && 'rotate-180')}
          />
        </button>
      </div>

      {/* Action menu */}
      {menuOpen ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Profile actions"
          onKeyDown={onMenuKeyDown}
          data-testid="profile-action-menu"
          className={cn(
            'absolute top-full left-0 z-50 mt-2 w-[17rem] max-w-[84vw] overflow-hidden rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)]',
            'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-100'
          )}
        >
          <MenuGroup>
            <MenuRow icon={ShieldCheck} label="Review on the record" onClick={openReview} />
          </MenuGroup>

          {topGaps.length > 0 ? (
            <MenuGroup heading="Close a gap">
              {topGaps.map((g) => (
                <MenuLinkRow
                  key={g.field}
                  href={gapHref(g.field)}
                  label={g.label}
                  dotColor={g.severity === 'missing' ? 'var(--danger)' : 'var(--warning)'}
                  onNavigate={() => setMenuOpen(false)}
                />
              ))}
              <MenuLinkRow
                href={EDIT}
                icon={PenLine}
                label={
                  profile.gaps.length > topGaps.length
                    ? `Edit all (${profile.gaps.length} open)`
                    : 'Edit in onboarding'
                }
                onNavigate={() => setMenuOpen(false)}
              />
            </MenuGroup>
          ) : (
            <MenuLinkRow
              href={EDIT}
              icon={PenLine}
              label="Edit in onboarding"
              onNavigate={() => setMenuOpen(false)}
            />
          )}

          <MenuGroup heading="Share">
            <MenuRow
              icon={shareState === 'copied' ? Check : shareState === 'error' ? AlertCircle : Share2}
              label={
                shareState === 'pending'
                  ? 'Creating link…'
                  : shareState === 'copied'
                    ? 'Public link copied'
                    : shareState === 'error'
                      ? 'Couldn’t create link'
                      : 'Copy public link'
              }
              onClick={onShare}
              tone={shareState === 'copied' ? 'success' : 'neutral'}
            />
          </MenuGroup>
        </div>
      ) : null}

      {/* Review drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={profile.fundName}
        subtitle={`${score}% on the record · ${
          profile.memberType ? MEMBER_TYPE_LABELS[profile.memberType] : 'Profile'
        }`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="rounded-lg border border-hairline px-3 py-1.5 text-[12px] font-semibold text-fg-2 transition hover:bg-surface-2"
            >
              Close
            </button>
            <Link
              href={EDIT}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cta-gradient)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-[var(--shadow-cta)] transition hover:brightness-110"
            >
              Open in onboarding
              <ArrowRight size={12} strokeWidth={2} aria-hidden />
            </Link>
          </>
        }
      >
        <ReviewBody profile={profile} tone={tone} />
      </Drawer>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Inline mini progress ring (compact variant)
 * ------------------------------------------------------------------------- */

function MiniRing({ score, color }: { score: number; color: string }) {
  const c = 2 * Math.PI * 7;
  const offset = c - (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <svg viewBox="0 0 18 18" className="h-[14px] w-[14px] flex-none -rotate-90" aria-hidden>
      <circle cx="9" cy="9" r="7" fill="none" stroke="var(--surface-2)" strokeWidth="2.5" />
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * Menu primitives (mirror AccountMenu styling)
 * ------------------------------------------------------------------------- */

const MENU_ITEM =
  'flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[12.5px] font-medium transition-[background] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';

function MenuGroup({ heading, children }: { heading?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-hairline px-2 py-1.5 first:border-t-0">
      {heading ? (
        <p className="px-1.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          {heading}
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onClick,
  tone = 'neutral'
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'success';
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        data-menu-item
        onClick={onClick}
        className={cn(
          MENU_ITEM,
          tone === 'success'
            ? 'text-success hover:bg-[var(--success-soft)]'
            : 'text-fg-2 hover:bg-surface-1 hover:text-fg-1'
        )}
      >
        <Icon
          size={15}
          strokeWidth={1.9}
          aria-hidden
          className={cn('flex-none', tone === 'success' ? 'text-success' : 'text-fg-4')}
        />
        <span className="flex-1 text-left">{label}</span>
      </button>
    </li>
  );
}

function MenuLinkRow({
  href,
  label,
  icon: Icon,
  dotColor,
  onNavigate
}: {
  href: string;
  label: string;
  icon?: LucideIcon;
  dotColor?: string;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        role="menuitem"
        data-menu-item
        onClick={onNavigate}
        className={cn(MENU_ITEM, 'text-fg-2 hover:bg-surface-1 hover:text-fg-1')}
      >
        {dotColor ? (
          <span
            className="h-1.5 w-1.5 flex-none rounded-full"
            style={{ backgroundColor: dotColor }}
            aria-hidden
          />
        ) : Icon ? (
          <Icon size={15} strokeWidth={1.9} aria-hidden className="flex-none text-fg-4" />
        ) : null}
        <span className="flex-1 truncate text-left">{label}</span>
      </Link>
    </li>
  );
}

/* ---------------------------------------------------------------------------
 * Review drawer body — read-only summary of the record
 * ------------------------------------------------------------------------- */

function ReviewBody({
  profile,
  tone
}: {
  profile: FundProfile;
  tone: { color: string; bg: string; label: string };
}) {
  const filled = profile.sections.filter((s) => s.present);
  const missing = profile.gaps;

  return (
    <div className="flex flex-col gap-4">
      {/* Completeness banner */}
      <div
        className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3"
        style={{ borderColor: tone.color, backgroundColor: tone.bg }}
      >
        <div className="min-w-0">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: tone.color }}
          >
            {tone.label} · on the record
          </p>
          <p className="mt-0.5 text-[12px] text-fg-2">
            {missing.length === 0
              ? 'Every required field is documented.'
              : `${missing.length} field${missing.length === 1 ? '' : 's'} left to document.`}
          </p>
        </div>
        <span className="text-[22px] font-semibold tabular-nums" style={{ color: tone.color }}>
          {profile.completenessScore}%
        </span>
      </div>

      {/* On the record */}
      {filled.length > 0 ? (
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            On the record
          </p>
          <ul className="flex flex-col gap-2">
            {filled.map((s) => (
              <ReviewSection key={s.id} section={s} />
            ))}
          </ul>
        </section>
      ) : null}

      {/* Gaps */}
      {missing.length > 0 ? (
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            Still to add
          </p>
          <ul className="flex flex-col gap-1.5">
            {missing.map((g) => (
              <li
                key={g.field}
                className="flex items-start gap-2.5 rounded-xl border border-hairline bg-bg-1 px-3 py-2"
              >
                <span
                  className="mt-1 h-1.5 w-1.5 flex-none rounded-full"
                  style={{
                    backgroundColor: g.severity === 'missing' ? 'var(--danger)' : 'var(--warning)'
                  }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-fg-1">{g.label}</p>
                  <p className="mt-0.5 text-[11.5px] text-fg-3">{g.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ReviewSection({ section }: { section: ProfileSection }) {
  return (
    <li className="rounded-xl border border-hairline bg-bg-1 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
        {section.label}
      </p>
      {section.kind === 'tags' ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {section.tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-hairline bg-surface-1 px-2 py-0.5 text-[11px] text-fg-2"
            >
              {t}
            </span>
          ))}
        </div>
      ) : section.kind === 'url' && section.href ? (
        <a
          href={section.href}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-azure-1 hover:underline"
        >
          <Link2 size={12} strokeWidth={2} aria-hidden />
          <span className="truncate">{section.text}</span>
          <ExternalLink size={11} strokeWidth={2} aria-hidden />
        </a>
      ) : (
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{section.text}</p>
      )}
    </li>
  );
}

export default ProfileActionButton;
