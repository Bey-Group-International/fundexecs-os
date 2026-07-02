import { NextRequest, NextResponse } from "next/server";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Format a Date as a Google Calendar datetime string: YYYYMMDDTHHmmssZ */
function toGCalDate(d: Date): string {
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    "00Z"
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const title = searchParams.get("title") || "Meeting";
  const roomCode = searchParams.get("roomCode") || "";
  const startIso = searchParams.get("startIso") || new Date().toISOString();
  const durationMinutes = parseInt(searchParams.get("durationMinutes") || "60", 10);

  const start = new Date(startIso);
  if (isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid startIso" }, { status: 400 });
  }

  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const origin = req.nextUrl.origin;
  const joinUrl = roomCode ? `${origin}/meetings/${roomCode}` : `${origin}/meetings`;

  const details = `Join meeting: ${joinUrl}`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toGCalDate(start)}/${toGCalDate(end)}`,
    details,
  });

  const url = `https://calendar.google.com/calendar/render?${params.toString()}`;

  return NextResponse.json({ url });
}
