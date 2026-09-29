/**
 * Dates in the reader's time zone, on a server-rendered page.
 *
 * This is the regression the move to the server introduced, so these tests are
 * about the DIFFERENCE between the two renders, not about formatting:
 *
 *   the first render is explicitly UTC, because the server has no other zone to
 *   use and a local-looking time in the wrong zone is worse than a labelled one;
 *   the render after mount is the reader's.
 *
 * Jest runs with TZ set by the environment, so each case sets the zone it needs
 * and states the instant it is checking, rather than trusting the default.
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExpiresIn, LocalTime } from "./LocalTime";

/** 20:00 in New York on the 23rd is 00:00 UTC on the 24th. */
const EVENING_IN_NEW_YORK = "2026-09-24T00:00:00.000Z";

const DATE_ONLY: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
};

/** Render, then let the post-mount effect run. */
async function renderSettled(ui: React.ReactElement) {
  const view = render(ui);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe("LocalTime", () => {
  it("shows the reader's date, not the server's", async () => {
    // The defect this exists for. Formatted on the server this reads
    // "Thursday, September 24" — a day the meeting was not held in.
    const spy = jest
      .spyOn(Date.prototype, "toLocaleString")
      .mockImplementation(function (this: Date, _locale, opts) {
        // Stand in for a browser in New York: no timeZone means "the reader's".
        const zone = (opts as Intl.DateTimeFormatOptions | undefined)?.timeZone ?? "America/New_York";
        return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: zone }).format(this);
      });

    await renderSettled(<LocalTime iso={EVENING_IN_NEW_YORK} options={DATE_ONLY} />);

    expect(screen.getByText(/Wednesday, September 23, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/September 24/)).toBeNull();
    spy.mockRestore();
  });

  it("labels what the SERVER sends as UTC rather than pretending it is local", () => {
    // Server-rendered for real, because that is the render being asserted — a
    // client render flushes the post-mount effect before anything can look at it.
    // A time with no zone on it invites the reader to believe it is theirs.
    const html = renderToStaticMarkup(
      <LocalTime
        iso="2026-09-23T18:30:00.000Z"
        options={{ month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }}
      />,
    );
    expect(html).toContain("6:30 PM UTC");
  });

  it("does not label a date-only server render, which has no hour to move", () => {
    // "Wednesday, September 23, 2026 UTC" is noise: a date has no zone-sensitive
    // part once the hour is gone.
    const html = renderToStaticMarkup(<LocalTime iso={EVENING_IN_NEW_YORK} options={DATE_ONLY} />);
    expect(html).toContain("September 24, 2026");
    expect(html).not.toContain("UTC");
  });

  it("keeps the machine-readable instant in the markup either way", async () => {
    // Whatever zone the text is in, anything reading the page rather than looking
    // at it gets the unambiguous instant.
    const { container } = await renderSettled(
      <LocalTime iso={EVENING_IN_NEW_YORK} options={DATE_ONLY} />,
    );
    expect(container.querySelector("time")).toHaveAttribute("dateTime", EVENING_IN_NEW_YORK);
  });

  it("renders nothing for a date it cannot read, rather than 'Invalid Date'", async () => {
    const { container } = await renderSettled(<LocalTime iso="not a date" options={DATE_ONLY} />);
    expect(container.querySelector("time")?.textContent).toBe("");
  });

  it("passes its className through, so it can stand where a string stood", async () => {
    const { container } = await renderSettled(
      <LocalTime iso={EVENING_IN_NEW_YORK} options={DATE_ONLY} className="text-sm" />,
    );
    expect(container.querySelector("time")).toHaveClass("text-sm");
  });

  it("settles instead of re-formatting forever on a fresh options object", async () => {
    // Every call site passes an object literal, so `options` is a new reference on
    // each render. Keyed on the reference, the post-mount setState would trigger a
    // render that triggers it again.
    const renders: number[] = [];
    function Counting() {
      renders.push(1);
      return <LocalTime iso={EVENING_IN_NEW_YORK} options={{ ...DATE_ONLY }} />;
    }
    await renderSettled(<Counting />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renders.length).toBeLessThan(5);
  });
});

describe("ExpiresIn", () => {
  const in3Days = new Date(Date.now() + 3 * 86_400_000).toISOString();

  it("counts down from the browser's clock once mounted", async () => {
    await renderSettled(<ExpiresIn iso={in3Days} />);
    expect(screen.getByText(/Deleted in 3 days/)).toBeInTheDocument();
  });

  it("says the date, not a countdown, in the server render", () => {
    // Both are true; only one can be computed without the reader's own clock, and
    // a countdown off the server's is the mismatch being avoided.
    const html = renderToStaticMarkup(<ExpiresIn iso="2026-12-23T00:00:00.000Z" />);
    expect(html).toContain("Deleted Dec 23, 2026");
    expect(html).not.toContain("Deleted in");
  });

  it("warns when the recording is nearly gone", async () => {
    await renderSettled(<ExpiresIn iso={new Date(Date.now() + 2 * 86_400_000).toISOString()} />);
    expect(screen.getByText(/Deleted in 2 days/)).toHaveClass("text-[var(--status-warning)]");
  });

  it("does not warn on a recording with months left", async () => {
    await renderSettled(<ExpiresIn iso={new Date(Date.now() + 60 * 86_400_000).toISOString()} />);
    expect(screen.getByText(/Deleted in 60 days/)).not.toHaveClass("text-[var(--status-warning)]");
  });

  it("says soon rather than a negative count once it is past", async () => {
    await renderSettled(<ExpiresIn iso={new Date(Date.now() - 86_400_000).toISOString()} />);
    expect(screen.getByText(/Deleted soon/)).toBeInTheDocument();
  });

  it("says one day, singular", async () => {
    await renderSettled(<ExpiresIn iso={new Date(Date.now() + 43_200_000).toISOString()} />);
    expect(screen.getByText(/Deleted in 1 day$/)).toBeInTheDocument();
  });
});
