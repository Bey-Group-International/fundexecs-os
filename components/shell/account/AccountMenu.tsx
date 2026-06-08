'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ComponentType,
  type ReactNode
} from 'react';
import Link from 'next/link';
import {
  Building2,
  Check,
  ChevronsUpDown,
  CreditCard,
  ExternalLink,
  FileText,
  Gift,
  Keyboard,
  LifeBuoy,
  LogOut,
  Plug,
  Plus,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Lock,
  type LucideIcon
} from 'lucide-react';
import { Avatar, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ShellIdentity } from '@/lib/queries/identity';
import { isPlatformAdmin } from '@/lib/access';
import { setActiveWorkspace } from '@/lib/actions/workspace';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';

export interface AccountMenuProps {
  identity: ShellIdentity;
  /** Sign-out handler — wired by the rail to the existing Supabase behavior. */
  onSignOut: () => void | Promise<void>;
  /** Called when a navigation link is followed (closes the mobile drawer). */
  onNavigate?: () => void;
}

/** External system-status surface — honest placeholder until a real one exists. */
const STATUS_URL = 'https://status.fundexecs.com';

/**
 * Per-account role label for the account bar. Every workspace has an Owner, so
 * whoever owns/administers their own workspace surfaces as "Owner" here —
 * "Admin" is reserved for the Bey Group platform team (the gated Admin menu
 * link), never a personal role. Members read "Member"; any legacy/custom value
 * (e.g. "Operator") is title-cased as a fallback.
 */
function roleLabel(role: string): string {
  const r = role?.toLowerCase();
  if (r === 'owner' || r === 'admin') return 'Owner';
  if (r === 'member') return 'Member';
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Member';
}

/**
 * AccountMenu — the side rail's bottom identity footer, turned into a popping
 * account menu (Claude Code style). The trigger is the identity row; clicking
 * it opens a popover **upward** with the identity header, the workspace/role
 * switcher, and the full set of entries. On mobile (inside the off-canvas
 * drawer) it renders as a full-width sheet.
 *
 * a11y: trigger carries `aria-expanded`/`aria-haspopup`; the popover is a
 * labeled `menu`; Esc and click-outside close; focus is trapped while open and
 * restored to the trigger on close; arrow keys move between items.
 */
export function AccountMenu({ identity, onSignOut, onNavigate }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const activeRole =
    identity.memberships.find((m) => m.orgId === identity.activeOrgId)?.role ?? identity.role;
  // Admin is reserved for the Bey Group team (@beygroupintl.com), not org role.
  const isAdmin = isPlatformAdmin(identity.email);

  // Click-outside closes the popover.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      const t = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(t) &&
        triggerRef.current &&
        !triggerRef.current.contains(t)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  // Esc closes + restore focus to the trigger. Don't steal Esc while the
  // shortcuts dialog (which sits above) is open — it handles its own Esc.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !shortcutsOpen) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, shortcutsOpen]);

  // Move focus into the popover on open; restore to trigger on close.
  useEffect(() => {
    if (open) {
      const first = popoverRef.current?.querySelector<HTMLElement>('[data-menu-item]');
      first?.focus();
    }
  }, [open]);

  // Arrow-key navigation + simple focus trap across the menu items.
  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) return;
    const items = Array.from(
      popoverRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? []
    ).filter((el) => !el.hasAttribute('disabled'));
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    if (e.key === 'Tab') {
      // Trap focus inside the popover.
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      const next = (currentIndex + dir + items.length) % items.length;
      items[next].focus();
      return;
    }

    e.preventDefault();
    let next = currentIndex;
    if (e.key === 'ArrowDown') next = (currentIndex + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (currentIndex - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    items[next]?.focus();
  }

  function handleNavigate() {
    setOpen(false);
    onNavigate?.();
  }

  return (
    <>
      <div className="relative m-3" data-testid="account-menu">
        {/* Popover (opens upward, bottom-anchored) */}
        {open ? (
          <div
            ref={popoverRef}
            id={menuId}
            role="menu"
            aria-label="Account menu"
            onKeyDown={onMenuKeyDown}
            data-testid="account-menu-popover"
            className={cn(
              'absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)]',
              'max-h-[min(70vh,560px)] overflow-y-auto',
              'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-100'
            )}
          >
            <MenuBody
              identity={identity}
              activeRole={activeRole}
              isAdmin={isAdmin}
              onNavigate={handleNavigate}
              onSignOut={onSignOut}
              onOpenShortcuts={() => setShortcutsOpen(true)}
            />
          </div>
        ) : null}

        {/* Trigger — the identity footer row */}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          data-testid="account-menu-trigger"
          className={cn(
            'flex w-full items-center gap-2.5 rounded-[10px] border border-hairline px-2.5 py-2.5 text-left transition-[background,box-shadow] hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1',
            open && 'bg-surface-1'
          )}
        >
          <Avatar name={identity.name} src={identity.avatarUrl} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-fg-1">{identity.name}</div>
            <div className="truncate text-[10.5px] text-fg-4">{identity.orgName}</div>
          </div>
          <Badge tone="gold" className="px-1.5 py-0.5 text-[10px]">
            L{identity.level}
          </Badge>
          <ChevronsUpDown size={14} strokeWidth={1.9} className="flex-none text-fg-4" aria-hidden />
        </button>
      </div>

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onClose={() => {
          setShortcutsOpen(false);
        }}
      />
    </>
  );
}

/* ----------------------------------------------------------------------------
 * Menu body
 * --------------------------------------------------------------------------*/

export interface MenuBodyProps {
  identity: ShellIdentity;
  activeRole: string;
  isAdmin: boolean;
  onNavigate: () => void;
  onSignOut: () => void | Promise<void>;
  onOpenShortcuts: () => void;
}

export function MenuBody({
  identity,
  activeRole,
  isAdmin,
  onNavigate,
  onSignOut,
  onOpenShortcuts
}: MenuBodyProps) {
  return (
    <div className="flex flex-col">
      {/* 1. Identity header */}
      <div className="flex items-start gap-3 border-b border-hairline px-3.5 py-3.5">
        <Avatar name={identity.name} src={identity.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-fg-1">{identity.name}</div>
          {identity.email ? (
            <div className="truncate text-[11.5px] text-fg-4">{identity.email}</div>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface-1 px-1.5 py-0.5 text-[10.5px] text-fg-3">
              <Building2 size={11} strokeWidth={2} aria-hidden />
              {identity.orgName}
            </span>
            <span className="inline-flex items-center rounded-md border border-hairline bg-surface-1 px-1.5 py-0.5 text-[10.5px] text-fg-3">
              {roleLabel(activeRole)}
            </span>
            <Badge tone="gold" className="px-1.5 py-0.5 text-[10px]">
              Level {identity.level}
            </Badge>
          </div>
        </div>
      </div>

      {/* 2. Workspace + role switcher */}
      <WorkspaceSwitcher identity={identity} onNavigate={onNavigate} />

      {/* 3–6. Core entries */}
      <MenuSection>
        <MenuLink href="/settings" icon={Settings} label="Settings" onNavigate={onNavigate} />
        {isAdmin ? (
          <MenuLink
            href="/settings#admin"
            icon={ShieldCheck}
            label="Admin"
            onNavigate={onNavigate}
          />
        ) : null}
        <MenuLink href="/integrations" icon={Plug} label="Integrations" onNavigate={onNavigate} />
        <MenuLink
          href="/settings#billing"
          icon={CreditCard}
          label="View plans"
          onNavigate={onNavigate}
        />
      </MenuSection>

      {/* 7–8. Gift + help */}
      <MenuSection>
        <MenuLink href="/gift" icon={Gift} label="Gift FundExecs" onNavigate={onNavigate} />
        <MenuLink href="/help" icon={LifeBuoy} label="Get help" onNavigate={onNavigate} />
      </MenuSection>

      {/* 9. Learn more */}
      <MenuSection heading="Learn more">
        <MenuLink href="/whats-new" icon={Sparkles} label="What's new" onNavigate={onNavigate} />
        <MenuLink href="/docs" icon={FileText} label="Documentation" onNavigate={onNavigate} />
        <MenuButton icon={Keyboard} label="Keyboard shortcuts" onClick={onOpenShortcuts} />
        <MenuLink href="/terms" icon={FileText} label="Terms" onNavigate={onNavigate} />
        <MenuLink href="/privacy" icon={Shield} label="Privacy" onNavigate={onNavigate} />
        <MenuExternalLink href={STATUS_URL} icon={ExternalLink} label="System status" />
      </MenuSection>

      {/* 10. Log out */}
      <MenuSection>
        <MenuButton
          icon={LogOut}
          label="Log out"
          tone="danger"
          onClick={() => {
            void onSignOut();
          }}
        />
      </MenuSection>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Workspace switcher
 * --------------------------------------------------------------------------*/

function WorkspaceSwitcher({
  identity,
  onNavigate
}: {
  identity: ShellIdentity;
  onNavigate: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function switchTo(orgId: string) {
    if (orgId === identity.activeOrgId || pending) return;
    setSwitchingTo(orgId);
    setError(null);
    startTransition(async () => {
      try {
        const result = await setActiveWorkspace(orgId);
        if (!result.ok) {
          setError(result.error);
        }
      } catch {
        setError('Unable to switch workspace right now. Please try again.');
      } finally {
        setSwitchingTo(null);
      }
      // On success, revalidatePath('/') re-renders the shell with the new org.
    });
  }

  return (
    <div className="border-b border-hairline px-2 py-2">
      <p className="px-1.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
        Workspaces &amp; roles
      </p>
      <ul className="flex flex-col gap-0.5" role="group" aria-label="Switch workspace">
        {identity.memberships.length === 0 ? (
          <li className="px-1.5 py-1.5 text-[12px] text-fg-4">No workspaces yet.</li>
        ) : (
          identity.memberships.map((m) => {
            const active = m.orgId === identity.activeOrgId;
            const busy = pending && switchingTo === m.orgId;
            return (
              <li key={m.orgId}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  data-menu-item
                  disabled={pending}
                  onClick={() => switchTo(m.orgId)}
                  data-testid={`workspace-option-${m.orgId}`}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left transition-[background] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-1 disabled:opacity-70',
                    active ? 'bg-surface-1' : 'hover:bg-surface-1'
                  )}
                >
                  <Avatar name={m.orgName} size={26} tone={active ? 'gold' : 'neutral'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-fg-1">
                      {m.orgName}
                    </span>
                    <span className="block truncate text-[10.5px] text-fg-4">
                      {roleLabel(m.role)} · {m.tier}
                    </span>
                  </span>
                  {busy ? (
                    <span className="text-[10px] text-fg-4">…</span>
                  ) : active ? (
                    <Check
                      size={15}
                      strokeWidth={2.2}
                      className="flex-none text-gold-1"
                      aria-hidden
                    />
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>

      {error ? (
        <p role="alert" className="px-1.5 pt-1 text-[11px] text-danger">
          {error}
        </p>
      ) : null}

      {/* Future multi-account slot — a clearly-labeled, styled placeholder so the
          layout already has room for separate logins. */}
      <div className="mt-1.5 border-t border-hairline pt-1.5">
        <button
          type="button"
          data-menu-item
          disabled
          aria-disabled="true"
          title="Multiple accounts are coming soon"
          className="flex w-full items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left text-fg-4 opacity-70"
        >
          <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg border border-dashed border-hairline">
            <Plus size={13} strokeWidth={2} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium">Add account</span>
            <span className="flex items-center gap-1 truncate text-[10.5px]">
              <Lock size={9} strokeWidth={2} aria-hidden />
              Separate logins — coming soon
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Menu primitives
 * --------------------------------------------------------------------------*/

function MenuSection({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <div className="border-b border-hairline px-2 py-1.5 last:border-b-0">
      {heading ? (
        <p className="px-1.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          {heading}
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

const ITEM_BASE =
  'flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[13px] font-medium transition-[background] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-1';

function MenuLink({
  href,
  icon: Icon,
  label,
  onNavigate
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        role="menuitem"
        data-menu-item
        onClick={onNavigate}
        className={cn(ITEM_BASE, 'text-fg-2 hover:bg-surface-1 hover:text-fg-1')}
      >
        <Icon size={16} strokeWidth={1.9} aria-hidden className="flex-none text-fg-4" />
        <span className="flex-1">{label}</span>
      </Link>
    </li>
  );
}

function MenuExternalLink({
  href,
  icon: Icon,
  label
}: {
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        role="menuitem"
        data-menu-item
        className={cn(ITEM_BASE, 'text-fg-2 hover:bg-surface-1 hover:text-fg-1')}
      >
        <Icon size={16} strokeWidth={1.9} aria-hidden className="flex-none text-fg-4" />
        <span className="flex-1">{label}</span>
      </a>
    </li>
  );
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
  tone = 'neutral'
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        data-menu-item
        onClick={onClick}
        className={cn(
          ITEM_BASE,
          tone === 'danger'
            ? 'text-danger hover:bg-[var(--danger-soft)]'
            : 'text-fg-2 hover:bg-surface-1 hover:text-fg-1'
        )}
      >
        <Icon
          size={16}
          strokeWidth={1.9}
          className={cn('flex-none', tone === 'danger' ? 'text-danger' : 'text-fg-4')}
        />
        <span className="flex-1 text-left">{label}</span>
      </button>
    </li>
  );
}

export default AccountMenu;
