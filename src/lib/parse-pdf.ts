import type { TransactionRow } from "./types";

const TRAIN_ROW_REGEX =
  /^([+\-]?[\d,]+?)(\d{2})入(.+?)出(.+?)[\\¥￥]([\d,]+?)(\d{2})$/;

function extractYearFromFilename(filename: string): number | undefined {
  const match = filename.match(/(20\d{2})(\d{2})(\d{2})/);
  if (match) return parseInt(match[1], 10);
  return undefined;
}

function parseRow(line: string): {
  month: number;
  day: number;
  from: string;
  to: string;
  amount: number;
} | null {
  const m = line.match(TRAIN_ROW_REGEX);
  if (!m) return null;
  const amountRaw = m[1].replace(/[,\s+]/g, "").replace(/^-/, "");
  const month = parseInt(m[2], 10);
  const from = m[3].replace(/\s+/g, "");
  const to = m[4].replace(/\s+/g, "");
  const day = parseInt(m[6], 10);
  const amount = Math.abs(parseInt(amountRaw, 10));
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    !from ||
    !to
  ) {
    return null;
  }
  return { month, day, from, to, amount };
}

export async function parsePdfToTransactions(
  data: Uint8Array,
  filename = "",
): Promise<TransactionRow[]> {
  // @ts-expect-error -- 内部モジュールを直接importしてindex.jsのテストロード回避
  const pdfModule = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as {
    default: (b: Buffer) => Promise<{ text: string }>;
  };
  const pdf = pdfModule.default;
  const buffer = Buffer.from(data);
  const result = await pdf(buffer);
  const text = result.text ?? "";

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: TransactionRow[] = [];
  let currentYear =
    extractYearFromFilename(filename) ?? new Date().getFullYear();
  let prevMonth = 0;

  for (const line of lines) {
    const parsed = parseRow(line);
    if (!parsed) continue;
    const { month, day, from, to, amount } = parsed;

    if (prevMonth > 0 && month < prevMonth) {
      currentYear += 1;
    }
    prevMonth = month;

    rows.push({
      id: crypto.randomUUID(),
      date: `${currentYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      from,
      to,
      amount,
      purpose: "",
    });
  }

  return rows;
}
