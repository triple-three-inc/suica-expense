import { PDFParse } from "pdf-parse";
import type { TransactionRow } from "./types";

const TRAIN_ROW_REGEX =
  /^([+\-]?[\d,]+)\s+(\d{1,2})\s+入\s+(.+?)\s+出\s+(.+?)\s+[\\¥￥]([\d,]+)\s+(\d{1,2})\s*$/;

function extractYearFromFilename(filename: string): number | undefined {
  const match = filename.match(/(20\d{2})(\d{2})(\d{2})/);
  if (match) return parseInt(match[1], 10);
  return undefined;
}

export async function parsePdfToTransactions(
  data: Uint8Array,
  filename = "",
): Promise<TransactionRow[]> {
  const parser = new PDFParse({ data });
  const result = await parser.getText();
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
    const m = line.match(TRAIN_ROW_REGEX);
    if (!m) continue;

    const amountRaw = m[1].replace(/[,\s]/g, "");
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
      continue;
    }

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
