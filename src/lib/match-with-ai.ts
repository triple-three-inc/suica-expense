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
各移動が「どの案件のための移動か」を判断してください。

最重要ルール:
- 「用件」として返すべきは、移動の目的となった**案件・打合せ・訪問・現地作業**などの予定です
- 移動そのものを表す予定（「移動」「出張」「電車」「通勤」「タクシー」など）は用件としては不適切。
  これらは選ばず、その前後の時間帯にある「案件」の予定を選ぶこと
- 終日予定（在宅勤務・出社・誕生日・残業申請など）も用件としては不適切。避けること

判断基準（優先度順）:
1. 移動時刻に近い時間帯の「案件」系予定（打合せ・訪問・MTG・会議・面談・現地・撮影・取材・キックオフなど）
2. 予定タイトルや場所に駅名が含まれる
3. 往復セット（行きと帰り）は同じ案件の可能性が高い
4. 上記のいずれでも妥当な予定が無ければ eventId を null

各移動について最も妥当な「案件の予定」を1つ選び、根拠を簡潔に書いてください。
迷ったら eventId は null にして、人間に手動で選んでもらいます（誤った自動入力よりマシ）。`;

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
