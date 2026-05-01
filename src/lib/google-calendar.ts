import { ensureFreshSession } from "./google-oauth";
import type { Session } from "./session";

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  isAllDay: boolean;
};

const CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export async function listEventsForDateRange(
  session: Session,
  startISO: string,
  endISO: string,
): Promise<{ events: CalendarEvent[]; session: Session }> {
  const fresh = await ensureFreshSession(session);
  const params = new URLSearchParams({
    timeMin: startISO,
    timeMax: endISO,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(`${CALENDAR_LIST_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${fresh.accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Calendar API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      location?: string;
      status?: string;
    }>;
  };
  const events: CalendarEvent[] = (data.items ?? [])
    .filter((it) => it.status !== "cancelled" && it.summary)
    .map((it) => ({
      id: it.id,
      summary: it.summary ?? "",
      start: it.start?.dateTime ?? it.start?.date ?? "",
      end: it.end?.dateTime ?? it.end?.date ?? "",
      location: it.location,
      isAllDay: !it.start?.dateTime,
    }));
  return { events, session: fresh };
}
