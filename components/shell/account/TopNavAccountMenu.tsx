'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import type { ShellIdentity } from '@/lib/queries/identity';
import { isPlatformAdmin } from '@/lib/access';
import { MenuBody } from './AccountMenu';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';

export interface TopNavAccountMenuProps {
  identity: ShellIdentity;
}

/**
 * TopNavAccountMenu — the top-nav profile avatar turned into the account hub.
 *
 * Mirrors the side-rail `AccountMenu` (same `MenuBody`: identity, workspace
 * switcher, Settings/Admin/Integrations/Billing, help, log out) but anchored to
 * the top-right avatar and opening **downward**. The trigger shows the user's
 * photo (Google sign-in or uploaded), falling back to initials.
 *
 * a11y: trigger carries `aria-expanded`/`aria-haspopup`; the popover is a
 * labeled region; Esc and click-outside close and restore focus to the trigger.
 */
export function TopNavAccountMenu({ identity }: TopNavAccountMenuProps) {
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

  // Esc closes + restores focus (unless the shortcuts dialog above owns Esc).
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

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign('/login');
  }

  return (
    <div className="relative" data-testid="topnav-account-menu">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Account menu"
        data-testid="topnav-account-trigger"
        className={cn(
          'flex flex-none items-center justify-center rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-gold-1 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0',
          'ring-1 ring-hairline hover:ring-[var(--gold-line)]',
          open && 'ring-2 ring-[var(--gold-line)]'
        )}
      >
        <Avatar name={identity.name} src={identity.avatarUrl} size={32} className="rounded-full" />
      </button>

      {open ? (
        <div
          ref={popoverRef}
          id={menuId}
          role="menu"
          aria-label="Account menu"
          data-testid="topnav-account-popover"
          className={cn(
            'absolute right-0 top-full z-50 mt-2 w-[290px] overflow-hidden rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)]',
            'max-h-[min(80vh,620px)] overflow-y-auto',
            'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-100'
          )}
        >
          <MenuBody
            identity={identity}
            activeRole={activeRole}
            isAdmin={isAdmin}
            onNavigate={() => setOpen(false)}
            onSignOut={handleSignOut}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
        </div>
      ) : null}

      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

export default TopNavAccountMenu;
