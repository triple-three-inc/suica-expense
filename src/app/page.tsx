"use client";

import { useState } from "react";
import type { TransactionRow, ParseResponse } from "@/lib/types";

export default function Home() {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setLoading(true);
    setError(null);
    setWarning(null);

    try {
      const allRows: TransactionRow[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/parse", {
          method: "POST",
          body: formData,
        });
        const data = (await res.json()) as ParseResponse & { error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? "解析に失敗しました");
        }
        allRows.push(...data.rows);
        if (data.warning) setWarning(data.warning);
      }
      setRows((prev) => [...prev, ...allRows]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setLoading(false);
    }
  }

  function updateRow(id: string, field: keyof TransactionRow, value: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              [field]: field === "amount" ? Number(value) || 0 : value,
            }
          : r,
      ),
    );
  }

  function deleteRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function clearAll() {
    if (rows.length === 0 || confirm("すべてクリアしますか？")) {
      setRows([]);
      setError(null);
      setWarning(null);
    }
  }

  function downloadCsv() {
    if (rows.length === 0) return;
    const header = ["日付", "乗車駅", "降車駅", "金額", "用件"];
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [r.date, r.from, r.to, r.amount, r.purpose ?? ""]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([`﻿${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `suica-expense-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            Suica 交通費取り込み
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            PDF または スクリーンショットをアップロードすると、交通費の履歴を自動で読み取ります。
          </p>
        </header>

        <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <label
            htmlFor="file-input"
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center transition hover:border-blue-400 hover:bg-blue-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-blue-500 dark:hover:bg-zinc-800/50"
          >
            <svg
              className="mb-2 h-10 w-10 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 16v-8m0 0l-4 4m4-4l4 4m-9 8h10a2 2 0 002-2v-6"
              />
            </svg>
            <span className="text-base font-medium text-zinc-700 dark:text-zinc-200">
              PDFまたは画像を選択
            </span>
            <span className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              複数ファイルの同時選択に対応
            </span>
            <input
              id="file-input"
              type="file"
              accept="application/pdf,image/*"
              multiple
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
              disabled={loading}
              className="sr-only"
            />
          </label>

          {loading && (
            <p className="mt-4 text-center text-sm text-blue-600 dark:text-blue-400">
              解析中... 少々お待ちください
            </p>
          )}
          {error && (
            <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          {warning && !error && (
            <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              {warning}
            </p>
          )}
        </section>

        {rows.length > 0 && (
          <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
              <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {rows.length} 件 / 合計
                </p>
                <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                  ¥{totalAmount.toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={clearAll}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  クリア
                </button>
                <button
                  onClick={downloadCsv}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                >
                  CSVダウンロード
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">日付</th>
                    <th className="px-3 py-2 font-medium">乗車駅</th>
                    <th className="px-3 py-2 font-medium">降車駅</th>
                    <th className="px-3 py-2 text-right font-medium">金額</th>
                    <th className="px-3 py-2 font-medium">用件</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={row.date}
                          onChange={(e) =>
                            updateRow(row.id, "date", e.target.value)
                          }
                          className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.from}
                          onChange={(e) =>
                            updateRow(row.id, "from", e.target.value)
                          }
                          className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.to}
                          onChange={(e) =>
                            updateRow(row.id, "to", e.target.value)
                          }
                          className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          value={row.amount}
                          onChange={(e) =>
                            updateRow(row.id, "amount", e.target.value)
                          }
                          className="w-24 rounded border border-transparent bg-transparent px-1 py-1 text-right text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.purpose ?? ""}
                          onChange={(e) =>
                            updateRow(row.id, "purpose", e.target.value)
                          }
                          placeholder="用件を入力"
                          className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => deleteRow(row.id)}
                          className="text-xs text-red-600 hover:text-red-700 dark:text-red-400"
                          aria-label="削除"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
