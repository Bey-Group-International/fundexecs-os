/**
 * BotMemo public-page scraper.
 *
 * BotMemo (botmemo.com) publishes AI funding intelligence on their public
 * /insights page. We scrape it with a browser-like User-Agent and parse key
 * metrics via regex — no API key required. Designed to fail silently: if the
 * page changes layout or blocks us, every field stays null and the caller
 * degrades gracefully.
 */

export interface BotMemoPulse {
  /** Total capital deployed in the latest tracked period (USD). */
  totalCapitalUsd: number | null;
  /** Number of deals tracked in the period. */
  dealCount: number | null;
  /** Human-readable period label, e.g. "Q1 2026". */
  period: string | null;
  /** Total AI startups indexed in the repository. */
  startupCount: number | null;
  /** Top verticals mentioned on the insights page. */
  topVerticals: string[];
  sourceUrl: string;
  fetchedAt: string;
}

const INSIGHTS_URL = 'https://botmemo.com/insights';
const STARTUPS_URL = 'https://botmemo.com/startups/';

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; FundExecsIntelBot/1.0; +https://fundexecs.com)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseCapital(html: string): number | null {
  // Matches "$289.99B", "$1.2T", "$450M", "$1,234B" etc.
  const m = html.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([BMT])\b/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  const unit = m[2].toUpperCase();
  const mul = unit === 'T' ? 1e12 : unit === 'B' ? 1e9 : 1e6;
  return Math.round(num * mul);
}

function parseDealCount(html: string): number | null {
  const m = html.match(/([\d,]+)\s+deals?\b/i);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

function parsePeriod(html: string): string | null {
  const m = html.match(/\b(Q[1-4]\s+20\d{2})\b/i);
  return m ? m[1] : null;
}

function parseStartupCount(html: string): number | null {
  // "13,500+ AI startups" or "13500 startups"
  const m = html.match(/([\d,]+)\+?\s+(?:AI\s+)?startups?\b/i);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

const KNOWN_VERTICALS = [
  'Infrastructure AI',
  'Enterprise AI',
  'Healthcare AI',
  'Fintech AI',
  'Legal AI',
  'Developer Tools',
  'Robotics',
  'Autonomous Vehicles',
  'Security AI',
  'Education AI',
  'Marketing AI',
  'Supply Chain AI',
];

function parseTopVerticals(html: string): string[] {
  return KNOWN_VERTICALS.filter((v) => html.toLowerCase().includes(v.toLowerCase())).slice(0, 5);
}

export async function fetchBotMemoPulse(): Promise<BotMemoPulse> {
  const pulse: BotMemoPulse = {
    totalCapitalUsd: null,
    dealCount: null,
    period: null,
    startupCount: null,
    topVerticals: [],
    sourceUrl: INSIGHTS_URL,
    fetchedAt: new Date().toISOString(),
  };

  // Fetch insights and startups pages concurrently; each can fail independently.
  const [insightsHtml, startupsHtml] = await Promise.all([
    fetchHtml(INSIGHTS_URL),
    fetchHtml(STARTUPS_URL),
  ]);

  if (insightsHtml) {
    pulse.totalCapitalUsd = parseCapital(insightsHtml);
    pulse.dealCount = parseDealCount(insightsHtml);
    pulse.period = parsePeriod(insightsHtml);
    pulse.topVerticals = parseTopVerticals(insightsHtml);
  }

  if (startupsHtml) {
    pulse.startupCount = parseStartupCount(startupsHtml);
    // Supplement verticals from startups page if insights page had none.
    if (pulse.topVerticals.length === 0) {
      pulse.topVerticals = parseTopVerticals(startupsHtml);
    }
  }

  return pulse;
}

/** Stable dedup key for a BotMemoPulse stored in market_signals. */
export function pulseExternalId(pulse: BotMemoPulse): string {
  // Use period label when available (e.g. "Q1-2026"); fall back to date.
  if (pulse.period) return pulse.period.replace(/\s+/g, '-').toUpperCase();
  return pulse.fetchedAt.slice(0, 10); // YYYY-MM-DD
}
