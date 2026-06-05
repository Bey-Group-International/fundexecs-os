'use client';

import { useRef, useState, forwardRef, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TagInputProps {
  /** Current tags. */
  value: string[];
  /** Called with the next tag list on any add/remove. */
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
  className?: string;
}

/**
 * TagInput — a simple chip editor. Type a value and press Enter or comma to add
 * it; Backspace on an empty field removes the last chip; each chip has a remove
 * button. Values are de-duplicated and trimmed. Forwards the ref to the text
 * input so the flow can focus it ("Write my own").
 */
export const TagInput = forwardRef<HTMLInputElement, TagInputProps>(function TagInput(
  { value, onChange, placeholder, id, className },
  ref
) {
  const [draft, setDraft] = useState('');
  const innerRef = useRef<HTMLInputElement | null>(null);

  function commit(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    if (!value.some((v) => v.toLowerCase() === tag.toLowerCase())) {
      onChange([...value, tag]);
    }
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 rounded-xl border border-hairline bg-surface-2 px-2.5 py-2 text-sm transition focus-within:border-[var(--accent-line)] focus-within:shadow-[0_0_0_3px_var(--accent-soft)]',
        className
      )}
      onClick={() => innerRef.current?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-surface-3 py-1 pl-2 pr-1 text-[12.5px] font-medium text-fg-1"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((v) => v !== tag));
            }}
            className="inline-flex items-center justify-center rounded text-fg-4 transition hover:text-fg-1"
          >
            <X size={13} strokeWidth={2} aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        placeholder={value.length ? '' : placeholder}
        className="min-w-[8ch] flex-1 bg-transparent px-1 py-0.5 text-fg-1 placeholder:text-fg-4 outline-none"
      />
    </div>
  );
});
