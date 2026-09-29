"use client";

import { useEffect, useState } from "react";

/**
 * Dates and times in the READER's time zone, on a page rendered by the server.
 *
 * This is the cost of moving the report to the server, and it is the one thing
 * the move genuinely broke rather than improved.
 *
 * While the page was a client component, `toLocaleDateString` ran in the browser
 * and used the reader's zone. On the server it uses the server's — UTC on Vercel.
 * A meeting at 20:00 in New York is 00:00 UTC the next day, so the line under the
 * title showed the wrong weekday and the wrong date. The consent timestamp was
 * worse: it exists so somebody can answer "was this recorded with consent, and
 * when", and a UTC hour with no zone label on it is a wrong answer to that,
 * quietly.
 *
 * There is also the hydration half. These values reach client components too, so
 * a server render formatting in UTC and a client hydration formatting in the
 * reader's zone produce different text for the same node.
 *
 * So: formatted after mount, from the ISO string. First paint carries an explicit
 * UTC rendering, which is the honest fallback — it says which zone it is in
 * rather than showing a local-looking time that is not local. `suppressHydration
 * Warning` because the two renders differ on purpose, and `<time dateTime>` so the
 * machine-readable instant is in the markup either way, for anything that reads
 * the page rather than looks at it.
 */
export function LocalTime({
  iso,
  options,
  className,
}: {
  iso: string;
  options: Intl.DateTimeFormatOptions;
  /** Passed through, so this can stand exactly where a formatted string stood. */
  className?: string;
}) {
  // The server's render, and the browser's first: explicitly labelled UTC rather
  // than a local-looking time in the wrong zone.
  const [text, setText] = useState(() => format(iso, { ...options, timeZone: "UTC" }, true));

  useEffect(() => {
    setText(format(iso, options, false));
    // `options` is an object literal at most call sites, so it is a new reference
    // every render. Keyed on its VALUES instead, or this would set state forever.
  }, [iso, JSON.stringify(options)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}

function format(iso: string, options: Intl.DateTimeFormatOptions, labelZone: boolean): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const out = at.toLocaleString("en-US", options);
  // Only when a TIME is being shown: labelling a date "UTC" is noise, because a
  // date has no hour for the zone to move.
  const showsTime = options.hour !== undefined || options.minute !== undefined;
  return labelZone && showsTime ? `${out} UTC` : out;
}

/**
 * How long until a recording is deleted, counted in the reader's own day.
 *
 * `Date.now()` on the server and in the browser are different instants, so this
 * differed between the server render and hydration — the same mismatch as the
 * dates above, in a number rather than a string. Counted after mount, from the
 * browser's clock, which is also the clock the reader is judging "three days
 * left" against.
 */
export function ExpiresIn({ iso }: { iso: string }) {
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    setDays(Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
  }, [iso]);

  // Before mount, the absolute date rather than a countdown: both are true, and a
  // countdown computed on the server's clock is the thing being avoided. An
  // expiry is the one item on this row that must not be guessed at — it is the
  // warning that the recording is about to be gone.
  if (days === null) {
    return (
      <time dateTime={iso} suppressHydrationWarning>
        {`Deleted ${new Date(iso).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })}`}
      </time>
    );
  }

  return (
    <span
      suppressHydrationWarning
      className={days <= 7 ? "text-[var(--status-warning)]" : undefined}
    >
      {days > 0 ? `Deleted in ${days} day${days === 1 ? "" : "s"}` : "Deleted soon"}
    </span>
  );
}
