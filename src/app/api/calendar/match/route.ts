import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listEventsForDateRange } from "@/lib/google-calendar";
import { matchTripsToEvents, type MatchableTrip, type MatchableEvent } from "@/lib/match-with-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  trips: Array<{
    id: string;
    date: string;
    time?: string;
    from: string;
    to: string;
    amount: number;
  }>;
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not_logged_in" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const trips = (body.trips ?? []).filter(
    (t): t is MatchableTrip =>
      typeof t.id === "string" &&
      typeof t.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
      typeof t.from === "string" &&
      typeof t.to === "string" &&
      typeof t.amount === "number",
  );

  if (trips.length === 0) {
    return NextResponse.json({ matches: [], eventsByDate: {} });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  const dates = [...new Set(trips.map((t) => t.date))].sort();
  const startISO = `${dates[0]}T00:00:00+09:00`;
  const endISO = `${dates[dates.length - 1]}T23:59:59+09:00`;

  try {
    const { events } = await listEventsForDateRange(session, startISO, endISO);

    const eventsByDate: Record<string, MatchableEvent[]> = {};
    for (const date of dates) eventsByDate[date] = [];
    for (const ev of events) {
      const dateStr = ev.start.slice(0, 10);
      if (eventsByDate[dateStr]) {
        eventsByDate[dateStr].push({
          id: ev.id,
          summary: ev.summary,
          start: ev.start,
          end: ev.end,
          location: ev.location,
          isAllDay: ev.isAllDay,
        });
      }
    }

    const matches = await matchTripsToEvents(trips, eventsByDate, apiKey);

    const summaryById: Record<string, string> = {};
    for (const list of Object.values(eventsByDate)) {
      for (const ev of list) summaryById[ev.id] = ev.summary;
    }

    const enriched = matches.map((m) => ({
      tripId: m.tripId,
      eventId: m.eventId,
      summary: m.eventId ? (summaryById[m.eventId] ?? null) : null,
      confidence: m.confidence,
      reason: m.reason,
    }));

    return NextResponse.json({ matches: enriched, eventsByDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
