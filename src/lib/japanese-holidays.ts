const HOLIDAYS_URL = "https://holidays-jp.github.io/api/v1/date.json";

let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

export async function fetchJapaneseHolidays(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(HOLIDAYS_URL);
      if (!res.ok) return {};
      cache = (await res.json()) as Record<string, string>;
      return cache;
    } catch {
      return {};
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function isWeekend(dateStr: string): boolean {
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function isNonWorkingDay(
  dateStr: string,
  holidays: Record<string, string>,
): boolean {
  return isWeekend(dateStr) || Boolean(holidays[dateStr]);
}
