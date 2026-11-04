"use client";

// A date wheel (month, day, year) and a clock wheel (hour, minute, AM/PM). Scroll or tap a
// value to choose it. Used for a date-and-time block: it starts at now and the signer may adjust.
import { useEffect, useRef } from "react";
import { formatBlockDateTime, toOffsetIso } from "@/lib/signing/blocks";

const ITEM = 36;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => i + from);
const two = (n: number) => String(n).padStart(2, "0");

function Wheel({ label, items, index, onSelect }: { label: string; items: string[]; index: number; onSelect: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<number | undefined>(undefined);

  // Keep the chosen value in the middle.
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollTop - index * ITEM) > 1) el.scrollTop = index * ITEM;
  }, [index, items.length]);
  useEffect(() => () => window.clearTimeout(settle.current), []);

  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onScroll={() => {
          window.clearTimeout(settle.current);
          settle.current = window.setTimeout(() => {
            const el = ref.current;
            if (!el) return;
            const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)));
            if (i !== index) onSelect(i);
          }, 90);
        }}
        className="snap-y snap-mandatory overflow-y-auto scroll-smooth [scrollbar-width:none]"
        style={{ height: ITEM * 3, paddingTop: ITEM, paddingBottom: ITEM }}
      >
        {items.map((t, i) => (
          <div
            key={`${t}-${i}`}
            role="option"
            aria-selected={i === index}
            onClick={() => onSelect(i)}
            style={{ height: ITEM }}
            className={`flex cursor-pointer snap-center items-center justify-center text-sm ${i === index ? "font-semibold text-fg-primary" : "text-fg-muted"}`}
          >
            {t}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 border-y border-gold-500/40 bg-gold-500/5" style={{ top: ITEM, height: ITEM }} />
    </div>
  );
}

export function DateTimeWheels({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const y = value.getFullYear();
  const mo = value.getMonth();
  const d = value.getDate();
  const h24 = value.getHours();
  const mi = value.getMinutes();
  const pm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const thisYear = new Date().getFullYear();
  const years = [thisYear - 1, thisYear, thisYear + 1];
  const days = new Date(y, mo + 1, 0).getDate();

  const set = (parts: { y?: number; mo?: number; d?: number; h12?: number; mi?: number; pm?: boolean }) => {
    const ny = parts.y ?? y;
    const nmo = parts.mo ?? mo;
    const nd = Math.min(parts.d ?? d, new Date(ny, nmo + 1, 0).getDate());
    const nh12 = parts.h12 ?? h12;
    const npm = parts.pm ?? pm;
    onChange(new Date(ny, nmo, nd, (nh12 % 12) + (npm ? 12 : 0), parts.mi ?? mi));
  };

  return (
    <div>
      <div className="flex gap-3">
        <div className="flex flex-1 gap-1" role="group" aria-label="Date">
          <Wheel label="Month" items={MONTHS} index={mo} onSelect={(i) => set({ mo: i })} />
          <Wheel label="Day" items={range(days, 1).map(String)} index={d - 1} onSelect={(i) => set({ d: i + 1 })} />
          <Wheel label="Year" items={years.map(String)} index={Math.max(0, years.indexOf(y))} onSelect={(i) => set({ y: years[i] })} />
        </div>
        <div className="flex flex-1 gap-1" role="group" aria-label="Time">
          <Wheel label="Hour" items={range(12, 1).map(String)} index={h12 - 1} onSelect={(i) => set({ h12: i + 1 })} />
          <Wheel label="Minute" items={range(60).map(two)} index={mi} onSelect={(i) => set({ mi: i })} />
          <Wheel label="AM or PM" items={["AM", "PM"]} index={pm ? 1 : 0} onSelect={(i) => set({ pm: i === 1 })} />
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-fg-muted">{formatBlockDateTime(toOffsetIso(value))}</p>
    </div>
  );
}
