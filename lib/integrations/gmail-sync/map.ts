// lib/integrations/gmail-sync/map.ts
// One Gmail API message, as the inbox ingests it — or the reason it is not.
//
// The mailbox sweep (./sync.server.ts) reads the org's connected Gmail account
// and hands every new message here. What comes back is the same InboundEvent
// the webhooks produce, so a synced message goes through the same claim →
// thread → message → CRM timeline path as everything else that reaches the
// inbox, and nothing downstream needs to know which route it came by.
//
// Most of a mailbox is not communication: newsletters, receipts, alerts, social
// notifications. Every one of those that reached inbox_threads would be a row
// on the board, a candidate on a contact's timeline and a line in a report, so
// they are filtered HERE, on Gmail's own classification and the bulk-mail
// headers, before a single write happens. That is the cheapest place to make
// the inbox about people.
//
// Threads are keyed the way the Resend inbound path keys them — counterparty
// plus normalised subject — so a conversation that arrives both ways lands on
// one thread instead of two.
//
// Pure: no network, no database, no clock.

import { normalizeEmail } from "@/lib/crm/contact-match";
import { normalizeSubject, parseAddress } from "@/lib/integrations/inbound/resend";
import type { InboundEvent } from "@/lib/integrations/inbound/types";
import { FUNDEXECS_ORIGIN_HEADER } from "@/lib/email-headers";

/** The parts of a Gmail `users.messages.get?format=full` response this reads. */
export interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

/** How much of one message the inbox keeps. A thread is not an archive. */
export const MESSAGE_BODY_MAX = 20_000;

/**
 * Labels that mean "not a conversation". Gmail's own categories do most of the
 * work: a message it filed under Promotions or Social is one nobody will want
 * on a relationship timeline.
 */
const SKIP_LABELS = new Set([
  "SPAM",
  "TRASH",
  "DRAFT",
  "CHAT",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);

export type SkipReason =
  | "malformed"
  | "label"
  | "sent_by_app"
  | "bulk"
  | "automated_sender"
  | "no_counterparty";

export type MapResult =
  | { ok: true; event: InboundEvent }
  | { ok: false; reason: SkipReason };

function header(part: GmailMessagePart | undefined, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const h of part?.headers ?? []) {
    if ((h.name ?? "").toLowerCase() === wanted) return h.value ?? "";
  }
  return null;
}

/** Every address in an address-list header ("A <a@x>, b@y"). */
export function addressList(value: string | null): Array<{ name: string | null; email: string }> {
  if (!value) return [];
  // Split on commas that are not inside a quoted display name.
  const out: Array<{ name: string | null; email: string }> = [];
  let depth = false;
  let current = "";
  for (const ch of value) {
    if (ch === '"') depth = !depth;
    if (ch === "," && !depth) {
      out.push(...one(current));
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(...one(current));
  return out;

  function one(raw: string) {
    const parsed = parseAddress(raw);
    const email = normalizeEmail(parsed.email);
    return email ? [{ name: parsed.name, email }] : [];
  }
}

const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce[s]?)([+.-].*)?$/i;

/** A sender nobody can have a conversation with. */
export function isAutomatedSender(email: string): boolean {
  const local = email.slice(0, email.indexOf("@"));
  return AUTOMATED_LOCAL.test(local);
}

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/** The first part of this MIME type anywhere in the tree, depth first. */
function findPart(part: GmailMessagePart | undefined, mimeType: string): GmailMessagePart | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

/** HTML down to readable text. Good enough for a preview and a report; not a renderer. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The new text of a reply, without the quoted history under it.
 *
 * Every message in a thread repeats every message before it. Kept, a
 * twenty-reply thread stores the first message twenty times, and a report
 * built from it reads the same paragraph over and over.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "On Tue, 1 Oct 2026 at 09:00, Ana <ana@x.com> wrote:" — which Gmail
    // sometimes wraps across two lines.
    const joined = `${line} ${lines[i + 1] ?? ""}`;
    if (/^On .+wrote:\s*$/.test(line.trim()) || /^On .+wrote:\s*$/.test(joined.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim())) break;
    if (/^_{5,}$/.test(line.trim()) && /^From:/i.test((lines[i + 1] ?? "").trim())) break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  const result = out.join("\n").trim();
  // A message that is ALL quote (a bare forward) keeps its text rather than
  // becoming empty.
  return result || text.trim();
}

/** The readable body of a message. */
export function messageText(message: GmailMessage): string {
  const plain = findPart(message.payload, "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  const html = findPart(message.payload, "text/html");
  if (html?.body?.data) return htmlToText(decodeBase64Url(html.body.data));
  return message.snippet ?? "";
}

/**
 * Map one Gmail message to an inbox event for this mailbox.
 *
 * `mailbox` is the connected account's own address. A message from it is
 * outbound, and its counterparty is whoever it was sent to — so a conversation
 * the firm STARTED reaches the inbox and the timeline too, not only the ones
 * somebody else did.
 */
export function mapGmailMessage(message: GmailMessage, mailbox: string): MapResult {
  if (!message.id || !message.payload) return { ok: false, reason: "malformed" };

  const labels = message.labelIds ?? [];
  if (labels.some((l) => SKIP_LABELS.has(l))) return { ok: false, reason: "label" };

  // Mail this app sent through the mailbox is already on its thread.
  if (header(message.payload, FUNDEXECS_ORIGIN_HEADER) !== null) {
    return { ok: false, reason: "sent_by_app" };
  }

  // Mailing lists and bulk senders: real people do not set these.
  const precedence = (header(message.payload, "Precedence") ?? "").toLowerCase();
  if (
    header(message.payload, "List-Unsubscribe") !== null ||
    header(message.payload, "List-Id") !== null ||
    precedence === "bulk" ||
    precedence === "list" ||
    (header(message.payload, "Auto-Submitted") ?? "no").toLowerCase() !== "no"
  ) {
    return { ok: false, reason: "bulk" };
  }

  const self = normalizeEmail(mailbox);
  const [from] = addressList(header(message.payload, "From"));
  if (!from) return { ok: false, reason: "malformed" };

  const outbound = from.email === self || labels.includes("SENT");
  const counterparty = outbound
    ? [
        ...addressList(header(message.payload, "To")),
        ...addressList(header(message.payload, "Cc")),
      ].find((a) => a.email !== self)
    : from;
  if (!counterparty) return { ok: false, reason: "no_counterparty" };
  if (!outbound && isAutomatedSender(counterparty.email)) {
    return { ok: false, reason: "automated_sender" };
  }

  const subject = (header(message.payload, "Subject") ?? "").trim() || "(no subject)";
  const raw = messageText(message);
  const body = stripQuotedReply(raw).slice(0, MESSAGE_BODY_MAX) || "(empty message)";
  const internal = Number(message.internalDate);
  const occurredAt = Number.isFinite(internal) && internal > 0 ? new Date(internal).toISOString() : null;

  return {
    ok: true,
    event: {
      eventType: outbound ? "gmail.sent" : "gmail.received",
      // Gmail's message id is stable and unique per mailbox: the idempotency
      // key, so a message the sweep sees twice is ingested once.
      eventId: `gmail:${message.id}`,
      thread: {
        channel: "gmail",
        category: "messaging",
        subject,
        counterpartyName: counterparty.name,
        counterpartyEmail: counterparty.email,
        // The Resend path's key, deliberately: one conversation, one thread.
        threadKey: `email:${counterparty.email}:${normalizeSubject(subject)}`,
      },
      message: {
        author: outbound ? (from.name ?? from.email) : (counterparty.name ?? counterparty.email),
        body,
        occurredAt,
        direction: outbound ? "outbound" : "inbound",
        metadata: {
          via: "gmail_sync",
          gmail_message_id: message.id,
          gmail_thread_id: message.threadId ?? null,
          message_id: header(message.payload, "Message-ID"),
        },
      },
    },
  };
}
