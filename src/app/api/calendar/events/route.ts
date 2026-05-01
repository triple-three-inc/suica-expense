import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listEventsForDateRange } from "@/lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not_logged_in" }, { status: 401 });
  }

  let body: { dates?: string[] };
  try {
    body = (await request.json()) as { dates?: string[] };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const dates = (body.dates ?? []).filter((d): d is string =>
    typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
  );
  if (dates.length === 0) {
    return NextResponse.json({ eventsByDate: {} });
  }

  const sorted = [...new Set(dates)].sort();
  const startISO = `${sorted[0]}T00:00:00+09:00`;
  const endISO = `${sorted[sorted.length - 1]}T23:59:59+09:00`;

  try {
    const { events } = await listEventsForDateRange(session, startISO, endISO);
    const eventsByDate: Record<
      string,
      Array<{ summary: string; location?: string; start: string; isAllDay: boolean }>
    > = {};
    for (const date of sorted) eventsByDate[date] = [];
    for (const ev of events) {
      const dateStr = ev.start.slice(0, 10);
      if (eventsByDate[dateStr]) {
        eventsByDate[dateStr].push({
          summary: ev.summary,
          location: ev.location,
          start: ev.start,
          isAllDay: ev.isAllDay,
        });
      }
    }
    return NextResponse.json({ eventsByDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
