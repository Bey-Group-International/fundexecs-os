"use client";

import { useEffect, useRef, useState } from "react";
function Brain({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 001.5 2.121m-3 0a2.25 2.25 0 003 0m0 0v1.5a2.25 2.25 0 002.25 2.25H18a2.25 2.25 0 002.25-2.25V15M12 3.104a24.3 24.3 0 014.5.082M9 18.75a2.25 2.25 0 002.25 2.25h1.5a2.25 2.25 0 002.25-2.25" /></svg>;
}
function ChevronUp({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>;
}
function ChevronDown({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>;
}
import { createClient } from "@/lib/supabase/client";
import type { SessionMemoryCard } from "@/lib/brains/session-memory";

interface Props {
  sessionId: string;
  initialCard?: SessionMemoryCard | null;
}

type EntityType = SessionMemoryCard["entities"][number]["type"];

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  person: "Person",
  company: "Company",
  deal: "Deal",
  fund: "Fund",
  other: "Other",
};

function EntityChip({ type }: { type: EntityType }) {
  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
      {ENTITY_TYPE_LABELS[type]}
    </span>
  );
}

function SectionPill({ color, label }: { color: string; label: string }) {
  return (
    <span
      className={`text-xs font-semibold uppercase tracking-wide ${color}`}
    >
      {label}
    </span>
  );
}

interface ItemRowProps {
  borderColor: string;
  children: React.ReactNode;
}

function ItemRow({ borderColor, children }: ItemRowProps) {
  return (
    <div
      className={`pl-3 py-1 text-sm text-fg-primary border-l-2 ${borderColor}`}
    >
      {children}
    </div>
  );
}

function isEmpty(card: SessionMemoryCard): boolean {
  return (
    card.entities.length === 0 &&
    card.decisions.length === 0 &&
    card.open_questions.length === 0 &&
    card.constraints.length === 0
  );
}

/**
 * Returns the first `n` "items" across decisions and entities combined,
 * for the collapsed preview.
 */
function buildPreviewItems(
  card: SessionMemoryCard,
  max: number,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  for (const d of card.decisions) {
    if (nodes.length >= max) break;
    nodes.push(
      <ItemRow key={`d-${d}`} borderColor="border-green-500">
        {d}
      </ItemRow>,
    );
  }

  for (const e of card.entities) {
    if (nodes.length >= max) break;
    nodes.push(
      <ItemRow key={`e-${e.name}`} borderColor="border-blue-500">
        <span className="font-medium">{e.name}</span>
        {e.note ? <span className="text-fg-muted ml-1">— {e.note}</span> : null}
        <EntityChip type={e.type} />
      </ItemRow>,
    );
  }

  return nodes;
}

export function MemoryCard({ sessionId, initialCard = null }: Props) {
  const [card, setCard] = useState<SessionMemoryCard | null>(initialCard ?? null);
  const [expanded, setExpanded] = useState(false);
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    const supabase = supabaseRef.current;

    const channel = supabase
      .channel(`session-memory:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const raw = (payload.new as Record<string, unknown>)["memory_card"];
          if (!raw || typeof raw !== "object") return;
          const mc = raw as Partial<SessionMemoryCard>;
          if (
            Array.isArray(mc.entities) &&
            Array.isArray(mc.decisions) &&
            Array.isArray(mc.open_questions) &&
            Array.isArray(mc.constraints)
          ) {
            setCard({
              entities: mc.entities,
              decisions: mc.decisions,
              open_questions: mc.open_questions,
              constraints: mc.constraints,
              updated_at: mc.updated_at ?? new Date().toISOString(),
            });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const hasCard = card !== null && !isEmpty(card);
  const totalItems = hasCard
    ? card.entities.length +
      card.decisions.length +
      card.open_questions.length +
      card.constraints.length
    : 0;
  const showToggle = totalItems > 3;

  return (
    <div className="rounded-xl border border-line bg-surface-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
        <Brain className="w-4 h-4 text-fg-muted shrink-0" />
        <span className="text-sm font-semibold text-fg-primary flex-1">
          Session Memory
        </span>
        {hasCard && card.updated_at && (
          <span className="text-xs text-fg-muted">
            {new Date(card.updated_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {!hasCard ? (
          <p className="text-sm text-fg-muted italic">No memory captured yet</p>
        ) : expanded ? (
          <>
            {/* Entities */}
            {card.entities.length > 0 && (
              <div className="space-y-1">
                <SectionPill color="text-blue-600 dark:text-blue-400" label="Entities" />
                {card.entities.map((e) => (
                  <ItemRow key={e.name} borderColor="border-blue-500">
                    <span className="font-medium">{e.name}</span>
                    {e.note ? (
                      <span className="text-fg-muted ml-1">— {e.note}</span>
                    ) : null}
                    <span className="ml-2">
                      <EntityChip type={e.type} />
                    </span>
                  </ItemRow>
                ))}
              </div>
            )}

            {/* Decisions */}
            {card.decisions.length > 0 && (
              <div className="space-y-1">
                <SectionPill color="text-green-600 dark:text-green-400" label="Decisions" />
                {card.decisions.map((d) => (
                  <ItemRow key={d} borderColor="border-green-500">
                    {d}
                  </ItemRow>
                ))}
              </div>
            )}

            {/* Open Questions */}
            {card.open_questions.length > 0 && (
              <div className="space-y-1">
                <SectionPill color="text-amber-600 dark:text-amber-400" label="Open Questions" />
                {card.open_questions.map((q) => (
                  <ItemRow key={q} borderColor="border-amber-500">
                    {q}
                  </ItemRow>
                ))}
              </div>
            )}

            {/* Constraints */}
            {card.constraints.length > 0 && (
              <div className="space-y-1">
                <SectionPill color="text-red-600 dark:text-red-400" label="Constraints" />
                {card.constraints.map((c) => (
                  <ItemRow key={c} borderColor="border-red-500">
                    {c}
                  </ItemRow>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Collapsed: top 3 preview items */
          <div className="space-y-1">
            {buildPreviewItems(card, 3)}
            {totalItems > 3 && (
              <p className="text-xs text-fg-muted pt-0.5">
                +{totalItems - 3} more item{totalItems - 3 !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Expand / Collapse toggle */}
      {hasCard && showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-center gap-1 py-2 border-t border-line text-xs text-fg-muted hover:text-fg-primary hover:bg-surface-1/60 transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              Show all {totalItems} items
            </>
          )}
        </button>
      )}
    </div>
  );
}
