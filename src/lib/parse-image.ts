import { GoogleGenAI, Type } from "@google/genai";
import type { TransactionRow } from "./types";

function buildPrompt(): string {
  const now = new Date();
  const tz = "Asia/Tokyo";
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayISO = dateFormatter.format(now);
  const dowJa = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
  const todayDow = dowJa[
    new Date(`${todayISO}T12:00:00+09:00`).getDay()
  ];
  return `この画像はSuicaの利用履歴です。iOS Wallet版とモバイルSuicaアプリ版があります。
電車・バスなどの交通費（駅から駅への移動）のみを抽出してください。

【今日の日付】 ${todayISO} (${todayDow})

【除外するもの】
- 「支払い」「物販」（コンビニ・自販機での買い物）
- 「チャージ」「入金」（残高の補充）
- 「カード照会」「残高照会」
- 「繰越」（残高の繰越）

【日付の読み方】
画像の表記を絶対日付（YYYY-MM-DD）に変換してください:
- 「今日」→ 今日の日付
- 「昨日」→ 今日の前日
- 「○曜日」（例: 火曜日、土曜日）→ 直近の過去のその曜日。今日と同じ曜日なら7日前
- 「YYYY/MM/DD」形式 → そのまま変換
- 「M/D」のみで年がない → 今日（${todayISO}）から見て直近の過去の日付。
  例: 今日が 2026-05-01 で「3/15」なら 2026-03-15、「12/20」なら 2025-12-20

【駅情報の読み方】

形式A: iOS Wallet
  上段: 降車駅（例: "武蔵小杉駅"）
  下段: "○○駅から - 交通機関" （例: "新橋駅から - 交通機関"）
  → 上段=降車駅、"〜から"の前=乗車駅、「交通機関」はカテゴリ名なので駅名ではない

形式B: モバイルSuicaアプリ
  「入 ○○ 出 △△」 → 入=乗車駅、出=降車駅

形式C: JR East Web「SF(電子マネー)利用履歴」表
  列: 月日 | 種別 | 利用場所 | 残高/差額
  種別が「入」「出」の2行ペアで1取引:
    例:
      04/11  入  綱島    ¥81
      04/11  出  元住吉  -180
    → 04/11 綱島→元住吉 ¥180（差額の絶対値）
  種別「物販」「カード モバイル」「現金」「カード照会」「チャージ」は取引でないので除外
  種別「バス等」は1行で1取引（場所欄の名前を from と to の両方に入れる）

【時刻】
時刻が画像にある場合は HH:MM 形式で。なければ空文字。

【絶対ルール】
- 乗車駅と降車駅の両方が画像に明記されていない場合は、その行を出力に含めないこと
- "Unknown Station"、"不明"、空文字などプレースホルダーを駅名として絶対に使わないこと
- 物販・チャージ・現金・カード・カード照会の行は、駅名が一見書かれているように見えても出力に含めない
- 同じ画像を何度処理しても同じ結果を返すこと（推測ではなく明示的な情報のみ使用）

【出力】各取引について:
- date (YYYY-MM-DD)
- time (HH:MM または空文字)
- from (乗車駅名・実在する駅名のみ)
- to (降車駅名・実在する駅名のみ)
- amount (正の整数、円)`;
}

const MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];

function isTransientError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /503|UNAVAILABLE|overloaded|high demand|429/.test(message);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function parseImageToTransactions(
  file: File,
  apiKey: string,
): Promise<TransactionRow[]> {
  const ai = new GoogleGenAI({ apiKey });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = Buffer.from(bytes).toString("base64");
  const mimeType = file.type || "image/png";

  const config = {
    temperature: 0,
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        rows: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING },
              time: { type: Type.STRING },
              from: { type: Type.STRING },
              to: { type: Type.STRING },
              amount: { type: Type.NUMBER },
            },
            required: ["date", "from", "to", "amount"],
          },
        },
      },
      required: ["rows"],
    },
  };

  const contents = [
    {
      role: "user",
      parts: [{ inlineData: { mimeType, data: base64 } }, { text: buildPrompt() }],
    },
  ];

  let lastError: unknown = null;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config,
        });
        const text = response.text;
        if (!text) throw new Error("Gemini returned empty response");
        return parseGeminiJson(text);
      } catch (err) {
        lastError = err;
        if (!isTransientError(err)) throw err;
        if (attempt === 0) await sleep(1500);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini API 全モデルが一時的に利用できません。時間を置いて再試行してください。");
}

function parseGeminiJson(text: string): TransactionRow[] {

  const parsed = JSON.parse(text) as {
    rows: Array<{
      date: string;
      time?: string;
      from: string;
      to: string;
      amount: number;
    }>;
  };

  const INVALID_STATION = /^(unknown|unknown station|不明|なし|none|n\/a|-|—)$/i;
  return parsed.rows
    .filter((r) => {
      const from = (r.from ?? "").trim();
      const to = (r.to ?? "").trim();
      if (!from || !to) return false;
      if (INVALID_STATION.test(from) || INVALID_STATION.test(to)) return false;
      if (!Number.isFinite(r.amount) || Math.abs(r.amount) <= 0) return false;
      return true;
    })
    .map((r) => ({
      id: crypto.randomUUID(),
      date: r.date,
      time: r.time?.match(/^\d{1,2}:\d{2}$/) ? r.time : undefined,
      from: r.from.trim(),
      to: r.to.trim(),
      amount: Math.abs(Math.round(r.amount)),
      purpose: "",
    }));
}
