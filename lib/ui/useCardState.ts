'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * The shared card state model. Notification, task, and objective cards all move
 * through the same lifecycle flags. A card can be `read`, `archived`, `closed`
 * (completed in place), or `deleted`. `closed` doubles as the "complete" flag —
 * completing a card closes it.
 */
export interface CardState {
  read: boolean;
  archived: boolean;
  closed: boolean;
  deleted: boolean;
}

const DEFAULT_STATE: CardState = {
  read: false,
  archived: false,
  closed: false,
  deleted: false
};

/** Any item the hook can track must carry a stable string `id`. */
export interface HasId {
  id: string;
}

/** An item merged with its current shared card state. */
export type WithCardState<T> = T & CardState;

export interface UseCardStateResult<T extends HasId> {
  /** The tracked items, each merged with its current card state. */
  items: Array<WithCardState<T>>;
  markRead: (id: string) => void;
  archive: (id: string) => void;
  /** Close a card (e.g. dismiss without completing). */
  close: (id: string) => void;
  /** Complete a card — marks it read and closed. */
  complete: (id: string) => void;
  delete: (id: string) => void;
  /** Clear all lifecycle flags for a card. */
  restore: (id: string) => void;
  /** Mark every tracked card as read. */
  markAllRead: () => void;
}

/**
 * Tiny shared state model for interactive cards across FundExecs OS screens.
 *
 * Each source item may seed initial flags (e.g. an already-read notification);
 * actions then layer a patch over that seed, keyed by id. Items are returned
 * merged with their resolved `{ read, archived, closed, deleted }` state, so
 * callers filter / style off plain booleans instead of bespoke reducers.
 */
export function useCardState<T extends HasId>(
  source: T[],
  seed?: (item: T) => Partial<CardState>
): UseCardStateResult<T> {
  const [patches, setPatches] = useState<Record<string, Partial<CardState>>>({});

  const patch = useCallback((id: string, next: Partial<CardState>) => {
    setPatches((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }, []);

  const markRead = useCallback((id: string) => patch(id, { read: true }), [patch]);
  const archive = useCallback((id: string) => patch(id, { archived: true, read: true }), [patch]);
  const close = useCallback((id: string) => patch(id, { closed: true }), [patch]);
  const complete = useCallback((id: string) => patch(id, { read: true, closed: true }), [patch]);
  const remove = useCallback((id: string) => patch(id, { deleted: true }), [patch]);
  const restore = useCallback(
    (id: string) => patch(id, { read: false, archived: false, closed: false, deleted: false }),
    [patch]
  );

  const markAllRead = useCallback(() => {
    setPatches((prev) => {
      const next: Record<string, Partial<CardState>> = { ...prev };
      for (const item of source) next[item.id] = { ...next[item.id], read: true };
      return next;
    });
  }, [source]);

  const items = useMemo(
    () =>
      source.map((item) => ({
        ...item,
        ...DEFAULT_STATE,
        ...(seed?.(item) ?? {}),
        ...patches[item.id]
      })),
    [source, seed, patches]
  );

  return {
    items,
    markRead,
    archive,
    close,
    complete,
    delete: remove,
    restore,
    markAllRead
  };
}
