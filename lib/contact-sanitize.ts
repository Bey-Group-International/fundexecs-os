// lib/contact-sanitize.ts
// The last line of defense against invalid or fabricated contact details in the
// Earn composer. Two jobs:
//   1. Validate individual fields (email / phone / LinkedIn) so only real,
//      well-formed values from Apollo ever reach the "Verified contacts" block.
//   2. Redact any email / phone / LinkedIn the CHAT MODEL writes in its own
//      prose — the verified block is the ONLY sanctioned source of contact
//      details, so anything the model emits is removed (streaming-safe).
// All functions are pure and dependency-free.

// --- Field validators -------------------------------------------------------

// Apollo returns placeholder emails when a real one isn't unlocked; these must
// never surface as "verified".
const PLACEHOLDER_EMAIL = /(email_not_unlocked|not_unlocked|notunlocked|no[-_]?reply|noreply|do[-_]?not[-_]?reply|example\.(com|org)|domain\.com|placeholder|unknown)/i;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim();
  if (e.length > 254 || PLACEHOLDER_EMAIL.test(e)) return false;
  return EMAIL_RE.test(e);
}

// Normalize a phone to a display string, or null if it isn't a plausible phone.
// Requires 10–15 digits (E.164 range). Preserves a leading + and the original
// separators when they look sane; otherwise returns a compact form.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/[A-Za-z]/.test(trimmed)) return null; // letters → not a phone
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  // Keep the human formatting if it only contains phone-safe characters.
  if (/^\+?[\d\s().-]+$/.test(trimmed)) return trimmed;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

const LINKEDIN_RE = /^https?:\/\/(www\.)?linkedin\.com\/(in|company|pub|school)\/[A-Za-z0-9\-_%]+\/?$/i;

export function isValidLinkedIn(url: string | null | undefined): boolean {
  if (!url) return false;
  return LINKEDIN_RE.test(url.trim());
}

// --- Prose redaction --------------------------------------------------------

// Matches an email, a LinkedIn URL, or a formatted phone number (NANP-style
// with separators or an international +NN … form). The phone pattern requires
// grouping separators so it does NOT swallow financial figures like $1,200,000.
const EMAIL_IN_TEXT = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const LINKEDIN_IN_TEXT = /\bhttps?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/gi;
const PHONE_IN_TEXT = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g;

const REDACTION = "[contact removed — see verified block]";

// Redact any contact details from a completed piece of text.
export function redactContacts(text: string): string {
  return text
    .replace(EMAIL_IN_TEXT, REDACTION)
    .replace(LINKEDIN_IN_TEXT, REDACTION)
    .replace(PHONE_IN_TEXT, REDACTION);
}

// Streaming-safe redactor. The chat reply streams token-by-token, so we can't
// scrub after the fact. This buffers text and only emits up to the last
// CLAUSE boundary (newline or sentence punctuation followed by whitespace) —
// a point that can never fall inside an email, URL, or phone number — redacting
// each flushed chunk. flush() redacts and returns whatever remains.
export class StreamingContactRedactor {
  private buf = "";

  // Index just past the last safe boundary in buf, or -1 if none.
  private lastBoundary(): number {
    let idx = -1;
    for (let i = 0; i < this.buf.length - 1; i++) {
      const c = this.buf[i];
      if (c === "\n") idx = i + 1;
      else if ((c === "." || c === "!" || c === "?" || c === ",") && /\s/.test(this.buf[i + 1])) idx = i + 2;
    }
    return idx;
  }

  push(delta: string): string {
    this.buf += delta;
    const cut = this.lastBoundary();
    if (cut <= 0) return "";
    const emit = this.buf.slice(0, cut);
    this.buf = this.buf.slice(cut);
    return redactContacts(emit);
  }

  flush(): string {
    const out = redactContacts(this.buf);
    this.buf = "";
    return out;
  }
}
