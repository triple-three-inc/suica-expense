import { GoogleGenAI, Type } from "@google/genai";
import type { TransactionRow } from "./types";

const PROMPT = `この画像はモバイルSuicaの利用履歴画面です。
交通費（駅から駅への移動）のみを抽出してください。

除外するもの:
- 物販（コンビニなどでの買い物）
- チャージ（入金）
- 繰越（残高の繰越）

各取引について以下の情報を抽出してください:
- 日付（YYYY-MM-DD形式）
- 乗車駅（入場駅）
- 降車駅（出場駅）
- 金額（正の整数、円）

年が画像に書かれていない場合は ${new Date().getFullYear()} を使用してください。
駅名が省略表記の場合（例: "都 新橋"）は画像に書かれているまま返してください。`;

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
      parts: [{ inlineData: { mimeType, data: base64 } }, { text: PROMPT }],
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
    rows: Array<{ date: string; from: string; to: string; amount: number }>;
  };

  return parsed.rows.map((r) => ({
    id: crypto.randomUUID(),
    date: r.date,
    from: r.from,
    to: r.to,
    amount: Math.abs(Math.round(r.amount)),
    purpose: "",
  }));
}
