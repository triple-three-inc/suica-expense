import { GoogleGenAI, Type } from "@google/genai";

export type MatchableTrip = {
  id: string;
  date: string;
  time?: string;
  from: string;
  to: string;
  amount: number;
};

export type MatchableEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  isAllDay: boolean;
};

export type MatchResult = {
  tripId: string;
  eventId: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const PROMPT = `あなたは交通費の用件を判断するアシスタントです。
社員のSuica利用履歴と、当日のGoogleカレンダー予定を見て、
各移動が「どの予定のための移動か」を判断してください。

判断基準:
1. 時刻が一致する予定を最優先（移動の時刻と予定の開始/終了が30分以内）
2. 駅名が予定タイトルや場所に含まれる
3. 往復セット（行きと帰り）は同じ用件になる可能性が高い
4. 終日予定（在宅・出社・誕生日など）は移動の用件として不適切なので避ける
5. 該当する予定がなければ eventId を null

各移動について最も妥当な予定を1つ選び、根拠を簡潔に書いてください。`;

export async function matchTripsToEvents(
  trips: MatchableTrip[],
  eventsByDate: Record<string, MatchableEvent[]>,
  apiKey: string,
): Promise<MatchResult[]> {
  if (trips.length === 0) return [];
  const hasAnyEvent = Object.values(eventsByDate).some((arr) => arr.length > 0);
  if (!hasAnyEvent) {
    return trips.map((t) => ({
      tripId: t.id,
      eventId: null,
      confidence: "low",
      reason: "該当日に予定なし",
    }));
  }

  const ai = new GoogleGenAI({ apiKey });

  const input = {
    trips: trips.map((t) => ({
      id: t.id,
      date: t.date,
      time: t.time ?? "",
      from: t.from,
      to: t.to,
      amount: t.amount,
    })),
    eventsByDate,
  };

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: PROMPT },
          { text: `入力:\n${JSON.stringify(input, null, 2)}` },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          matches: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                tripId: { type: Type.STRING },
                eventId: { type: Type.STRING },
                confidence: { type: Type.STRING },
                reason: { type: Type.STRING },
              },
              required: ["tripId", "confidence", "reason"],
            },
          },
        },
        required: ["matches"],
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("AIマッチング: 空のレスポンス");
  const parsed = JSON.parse(text) as {
    matches: Array<{
      tripId: string;
      eventId?: string;
      confidence: string;
      reason: string;
    }>;
  };

  return parsed.matches.map((m) => ({
    tripId: m.tripId,
    eventId: m.eventId && m.eventId.length > 0 ? m.eventId : null,
    confidence:
      m.confidence === "high" || m.confidence === "medium" || m.confidence === "low"
        ? m.confidence
        : "low",
    reason: m.reason,
  }));
}
