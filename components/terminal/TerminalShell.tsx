"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  deserializeLayout,
  serializeLayout,
  makeLeaf,
  openPane,
  splitPane,
  closePane,
  resizeSplit,
  focusPane,
  type Layout,
  type PaneNode,
  type SplitPane,
  type SplitDirection,
} from "@/lib/terminal/layout";
import type { CommandPlan } from "@/lib/terminal/dispatch";
import { CommandBar } from "./CommandBar";
import { PaneView } from "./PaneView";

// The terminal shell (System 1 + the command surface of System 2). A pure
// pane-tree (lib/terminal/layout) reduced in a client reducer, rendered as
// resizable splits, driven by the command bar. Every command flows parse →
// preview → dispatch through the action contract (lib/terminal/dispatch); the
// dispatch is recorded to command_runs, and the layout is persisted (debounced).
//
// Release 1 executes read-only navigation + opens analysis/Copilot workspaces.
// Workflow commands (writes, capital events, outreach) are recorded as intents
// awaiting execution wiring + approval — nothing is fabricated or bound-executed.

type Action =
  | { t: "open"; leaf: ReturnType<typeof makeLeaf> }
  | { t: "split"; targetId: string; direction: SplitDirection; leaf: ReturnType<typeof makeLeaf>; splitId: string }
  | { t: "close"; targetId: string }
  | { t: "resize"; splitId: string; sizes: number[] }
  | { t: "focus"; targetId: string }
  | { t: "set"; layout: Layout };

function reducer(state: Layout, action: Action): Layout {
  switch (action.t) {
    case "open":
      return openPane(state, action.leaf);
    case "split":
      return splitPane(state, action.targetId, action.direction, action.leaf, action.splitId);
    case "close":
      return closePane(state, action.targetId);
    case "resize":
      return resizeSplit(state, action.splitId, action.sizes);
    case "focus":
      return focusPane(state, action.targetId);
    case "set":
      return action.layout;
    default:
      return state;
  }
}

let idSeq = 0;
function newId(prefix: string): string {
  idSeq += 1;
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${idSeq}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`;
}

export function TerminalShell({
  initialLayout,
  recordCommandRunAction,
  persistLayoutAction,
}: {
  initialLayout: unknown;
  recordCommandRunAction: (input: {
    raw: string;
    dryRun?: boolean;
    status?: "succeeded" | "failed" | "rejected" | "pending_approval";
  }) => Promise<string | null>;
  persistLayoutAction: (serialized: unknown) => Promise<string | null>;
}) {
  const [layout, dispatch] = useReducer(reducer, initialLayout, deserializeLayout);
  const [status, setStatus] = useState<{ text: string; nonDelegable: boolean } | null>(null);
  const mountedRef = useRef(false);

  // Debounced layout persistence. Skip the first render (the initial layout is
  // already what the server handed us) so we don't write a no-op on mount.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const handle = setTimeout(() => {
      void persistLayoutAction(serializeLayout(layout)).catch(() => {});
    }, 800);
    return () => clearTimeout(handle);
  }, [layout, persistLayoutAction]);

  const record = useCallback(
    (raw: string, s: "succeeded" | "pending_approval") => {
      void recordCommandRunAction({ raw, status: s }).catch(() => {});
    },
    [recordCommandRunAction],
  );

  const onDispatch = useCallback(
    (plan: CommandPlan) => {
      switch (plan.kind) {
        case "navigate":
        case "analyze": {
          const p = plan.pane!;
          dispatch({
            t: "open",
            leaf: makeLeaf(newId("pane"), p.paneType, {
              title: p.title,
              entityLabel: p.entityLabel,
              command: plan.raw,
            }),
          });
          record(plan.raw, "succeeded");
          setStatus({ text: `Opened ${p.title}`, nonDelegable: false });
          break;
        }
        case "ask-earn":
        case "unknown": {
          dispatch({
            t: "open",
            leaf: makeLeaf(newId("pane"), "copilot", {
              title: "Earn",
              entityLabel: plan.raw,
              command: plan.raw,
            }),
          });
          if (plan.kind === "ask-earn") record(plan.raw, "succeeded");
          setStatus({ text: "Handed to Earn to plan.", nonDelegable: false });
          break;
        }
        case "workflow": {
          // Preview-only in Release 1: recorded as an intent awaiting execution
          // wiring + (for gated actions) human approval. Nothing is executed.
          record(plan.raw, "pending_approval");
          setStatus({
            text: plan.nonDelegable
              ? `${plan.parsed?.command.verb} recorded — awaiting human sign-off (Tier 3, non-delegable). Not executed.`
              : plan.requiresApproval
                ? `${plan.parsed?.command.verb} recorded — awaiting operator approval (Tier 2). Not executed.`
                : `${plan.parsed?.command.verb} recorded — awaiting execution wiring. Not executed.`,
            nonDelegable: plan.nonDelegable,
          });
          break;
        }
        case "incomplete":
        default:
          break;
      }
    },
    [record],
  );

  return (
    <div className="fx-ambient mx-auto flex h-[calc(100dvh-9rem)] max-w-none flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(212,175,106,0.6)]" />
          Terminal
        </span>
        {status ? (
          <span className={`truncate font-mono text-[11px] ${status.nonDelegable ? "text-status-danger" : "text-fg-muted"}`}>
            {status.text}
          </span>
        ) : null}
      </header>

      <CommandBar onDispatch={onDispatch} />

      <div className="min-h-0 flex-1">
        {layout.root ? (
          <PaneTree
            node={layout.root}
            focusedPaneId={layout.focusedPaneId}
            onFocus={(id) => dispatch({ t: "focus", targetId: id })}
            onClose={(id) => dispatch({ t: "close", targetId: id })}
            onSplit={(id, direction) =>
              dispatch({
                t: "split",
                targetId: id,
                direction,
                leaf: makeLeaf(newId("pane"), "blank"),
                splitId: newId("split"),
              })
            }
            onResize={(splitId, sizes) => dispatch({ t: "resize", splitId, sizes })}
          />
        ) : (
          <EmptyState
            onSeed={() =>
              dispatch({ t: "open", leaf: makeLeaf(newId("pane"), "blank") })
            }
          />
        )}
      </div>
    </div>
  );
}

function EmptyState({ onSeed }: { onSeed: () => void }) {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-line/70 bg-surface-1/50">
      <div className="text-center">
        <p className="text-sm text-fg-secondary">No panes open.</p>
        <button
          type="button"
          onClick={onSeed}
          className="mt-2 rounded-md border border-line/70 px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-2"
        >
          Open a pane
        </button>
      </div>
    </div>
  );
}

// Recursive renderer: a leaf is a PaneView; a split lays its children out with
// draggable dividers.
function PaneTree({
  node,
  focusedPaneId,
  onFocus,
  onClose,
  onSplit,
  onResize,
}: {
  node: PaneNode;
  focusedPaneId: string | null;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onSplit: (id: string, direction: SplitDirection) => void;
  onResize: (splitId: string, sizes: number[]) => void;
}) {
  if (node.kind === "leaf") {
    return (
      <PaneView
        pane={node}
        focused={node.id === focusedPaneId}
        onFocus={() => onFocus(node.id)}
        onClose={() => onClose(node.id)}
        onSplitRight={() => onSplit(node.id, "row")}
        onSplitDown={() => onSplit(node.id, "column")}
      />
    );
  }
  return (
    <SplitView
      node={node}
      focusedPaneId={focusedPaneId}
      onFocus={onFocus}
      onClose={onClose}
      onSplit={onSplit}
      onResize={onResize}
    />
  );
}

function SplitView({
  node,
  focusedPaneId,
  onFocus,
  onClose,
  onSplit,
  onResize,
}: {
  node: SplitPane;
  focusedPaneId: string | null;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onSplit: (id: string, direction: SplitDirection) => void;
  onResize: (splitId: string, sizes: number[]) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const isRow = node.direction === "row";

  const startDrag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const container = ref.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const total = isRow ? rect.width : rect.height;
    if (total <= 0) return;
    const pairSum = node.sizes[i] + node.sizes[i + 1];
    const startBefore = node.sizes.slice(0, i).reduce((a, b) => a + b, 0);

    const move = (ev: PointerEvent) => {
      const pos = isRow ? ev.clientX - rect.left : ev.clientY - rect.top;
      let first = pos / total - startBefore; // size of child i within the pair
      first = Math.max(0.05, Math.min(pairSum - 0.05, first));
      const next = [...node.sizes];
      next[i] = first;
      next[i + 1] = pairSum - first;
      onResize(node.id, next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={ref}
      className={`flex h-full min-h-0 w-full min-w-0 ${isRow ? "flex-row" : "flex-col"}`}
    >
      {node.children.map((child, i) => (
        <div key={child.id} className="contents">
          <div
            className="min-h-0 min-w-0"
            style={{ flexGrow: node.sizes[i], flexShrink: 1, flexBasis: 0 }}
          >
            <PaneTree
              node={child}
              focusedPaneId={focusedPaneId}
              onFocus={onFocus}
              onClose={onClose}
              onSplit={onSplit}
              onResize={onResize}
            />
          </div>
          {i < node.children.length - 1 ? (
            <div
              onPointerDown={startDrag(i)}
              role="separator"
              aria-orientation={isRow ? "vertical" : "horizontal"}
              className={`group flex shrink-0 items-center justify-center ${
                isRow ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize"
              }`}
            >
              <span
                className={`rounded-full bg-line/70 transition-colors group-hover:bg-gold-400/60 ${
                  isRow ? "h-8 w-0.5" : "h-0.5 w-8"
                }`}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
