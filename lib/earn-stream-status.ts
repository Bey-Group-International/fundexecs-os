// In-band status lines for Earn's streamed chat replies.
//
// /api/chat streams plain text. A caller that opts in (`stream_status: true`)
// also receives short progress notes — "Reading Project Atlas…", "Searching
// the web…" — framed between STX and ETX control characters so they ride the
// same stream without ever mixing into the answer. The dock strips them out
// and shows the latest one while Earn works; nothing framed is persisted.

const STX = "\u0002";
const ETX = "\u0003";

/** Frame a status note for the stream. */
export function encodeStatus(text: string): string {
  return `${STX}${text.replace(/[\u0002\u0003]/g, "").slice(0, 120)}${ETX}`;
}

/**
 * Splits a status-framed stream back into answer text and status notes.
 * Chunk boundaries can fall anywhere — including inside a frame — so an open
 * frame is held until its ETX arrives.
 */
export class StatusStreamParser {
  private pending = "";

  /** Feed one decoded chunk. Returns the answer text it carried and the latest status, if any. */
  push(chunk: string): { text: string; status: string | null } {
    let buf = this.pending + chunk;
    this.pending = "";
    let text = "";
    let status: string | null = null;
    for (;;) {
      const start = buf.indexOf(STX);
      if (start === -1) {
        text += buf;
        break;
      }
      text += buf.slice(0, start);
      const end = buf.indexOf(ETX, start + 1);
      if (end === -1) {
        this.pending = buf.slice(start);
        break;
      }
      status = buf.slice(start + 1, end);
      buf = buf.slice(end + 1);
    }
    return { text, status };
  }
}
