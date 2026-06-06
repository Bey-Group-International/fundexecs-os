import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

type NotificationRow = Database['public']['Tables']['notifications']['Row'];

export interface NotificationItem {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  meta: string;
  time: string;
  read: boolean;
  /** Same-origin route the "Take action" CTA navigates to, when provided. */
  href?: string;
}

/**
 * Accept only same-origin relative paths to avoid open-redirects from
 * author-controlled payloads (mirrors the login redirect guard).
 */
function safeHref(v: unknown): string | undefined {
  const s = asString(v);
  if (s && s.startsWith('/') && !s.startsWith('//')) return s;
  return undefined;
}

/** Coerce an unknown JSON value to a trimmed string, or undefined. */
function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v;
  return undefined;
}

/** Turn a snake/kebab notification type into a human label. */
function typeToCategory(type: string): string {
  const t = type.replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Compact relative time (e.g. "4m", "3h", "2d") from an ISO timestamp. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Fetch notifications for the signed-in user. Reads are real; the title /
 * body / meta are projected from the JSON `payload` with sensible fallbacks.
 * RLS-scoped via the server client; query errors degrade to an empty list.
 */
export async function getNotifications(userId: string): Promise<NotificationItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, payload, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  return (
    data as Pick<NotificationRow, 'id' | 'type' | 'payload' | 'read_at' | 'created_at'>[]
  ).map((n) => {
    const payload = (n.payload ?? {}) as Record<string, unknown>;
    const category = asString(payload.category) ?? typeToCategory(n.type);
    return {
      id: n.id,
      type: n.type,
      category,
      title: asString(payload.title) ?? category,
      body: asString(payload.body) ?? asString(payload.message) ?? '',
      meta: asString(payload.meta) ?? n.type,
      time: relativeTime(n.created_at),
      read: n.read_at != null,
      href: safeHref(payload.href) ?? safeHref(payload.link) ?? safeHref(payload.url)
    } satisfies NotificationItem;
  });
}
