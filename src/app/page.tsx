"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { TransactionRow, ParseResponse } from "@/lib/types";
import { fetchJapaneseHolidays, isNonWorkingDay } from "@/lib/japanese-holidays";

type FreeeStatus = {
  connected: boolean;
  userName?: string;
  userEmail?: string;
  companyId?: number;
};

type Me =
  | { loggedIn: false; freee: null }
  | {
      loggedIn: true;
      email: string;
      name?: string;
      picture?: string;
      freee: FreeeStatus | null;
    };

type EventSuggestion = {
  id: string;
  summary: string;
  location?: string;
  start: string;
  isAllDay: boolean;
};

type MatchInfo = {
  eventId: string | null;
  summary: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const STORAGE_KEY = "suica-expense:state-v1";

type PersistedState = {
  rows: TransactionRow[];
  eventsByDate: Record<string, EventSuggestion[]>;
  matchInfo: Record<string, MatchInfo>;
  selectedMonth?: string;
};

function previousMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function rowFingerprint(r: TransactionRow): string {
  return `${r.date}|${r.time ?? ""}|${r.from}|${r.to}|${r.amount}`;
}

function appendUnique(
  existing: TransactionRow[],
  incoming: TransactionRow[],
): { merged: TransactionRow[]; addedCount: number } {
  const seen = new Set(existing.map(rowFingerprint));
  const fresh = incoming.filter((r) => {
    const fp = rowFingerprint(r);
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
  return { merged: [...existing, ...fresh], addedCount: fresh.length };
}

export default function Home() {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [eventsByDate, setEventsByDate] = useState<Record<string, EventSuggestion[]>>({});
  const [matchInfo, setMatchInfo] = useState<Record<string, MatchInfo>>({});
  const [matching, setMatching] = useState(false);
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [excludeHolidays, setExcludeHolidays] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [pendingSlackMatch, setPendingSlackMatch] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>(previousMonth());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as PersistedState;
        if (saved.rows) setRows(saved.rows);
        if (saved.eventsByDate) setEventsByDate(saved.eventsByDate);
        if (saved.matchInfo) setMatchInfo(saved.matchInfo);
        if (typeof saved.selectedMonth === "string") setSelectedMonth(saved.selectedMonth);
      }
    } catch {}
    setHydrated(true);

    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setMe(data as Me))
      .catch(() => setMe({ loggedIn: false, freee: null }));

    fetchJapaneseHolidays().then(setHolidays);

    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    const freeeError = params.get("freee_error");
    const slackToken = params.get("slack");
    if (authError) {
      setError(`Googleログインエラー: ${authError}`);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (freeeError) {
      setError(`freee連携エラー: ${freeeError}`);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (slackToken) {
      window.history.replaceState({}, "", window.location.pathname);
      fetch(`/api/slack/handoff?token=${encodeURIComponent(slackToken)}`)
        .then(async (r) => {
          const data = (await r.json()) as { rows?: TransactionRow[]; error?: string };
          if (!r.ok) throw new Error(data.error ?? "リンクの読み込みに失敗");
          if (data.rows && data.rows.length > 0) {
            const incoming = data.rows;
            setRows((prev) => {
              const { merged, addedCount } = appendUnique(prev, incoming);
              const skipped = incoming.length - addedCount;
              if (addedCount === 0) {
                setWarning(`Slackの${incoming.length}件はすべて既に取り込み済みです`);
              } else if (skipped > 0) {
                setWarning(
                  `Slackから ${addedCount} 件追加（重複 ${skipped} 件は除外）`,
                );
              } else {
                setWarning(`Slackから ${addedCount} 件読み込みました`);
              }
              return merged;
            });
            setPendingSlackMatch(true);
          }
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : "Slackリンクのエラー");
        });
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const payload: PersistedState = { rows, eventsByDate, matchInfo, selectedMonth };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, [hydrated, rows, eventsByDate, matchInfo, selectedMonth]);

  const filteredRows =
    selectedMonth === ""
      ? rows
      : rows.filter((r) => r.date.startsWith(selectedMonth));
  const isFiltered = selectedMonth !== "" && rows.length !== filteredRows.length;

  async function submitToFreee() {
    if (!me?.loggedIn || !me.freee?.connected) return;
    if (filteredRows.length === 0) return;
    const monthLabel = selectedMonth ? `（${selectedMonth}）` : "";
    if (
      !confirm(
        `${filteredRows.length}件の交通費${monthLabel}をfreeeの経費精算申請として登録します。よろしいですか？`,
      )
    )
      return;

    setSubmitting(true);
    setSubmitResult(null);
    setError(null);

    try {
      const res = await fetch("/api/freee/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: filteredRows.map((r) => ({
            date: r.date,
            from: r.from,
            to: r.to,
            amount: r.amount,
            purpose: r.purpose,
          })),
        }),
      });
      const text = await res.text();
      let data: { error?: string; id?: number; title?: string; applicationNumber?: string; totalAmount?: number; count?: number } = {};
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`予期しない応答 (${res.status})`);
      }
      if (!res.ok) {
        throw new Error(data.error ?? `freee登録に失敗 (${res.status})`);
      }
      setSubmitResult(
        `freeeに登録しました：「${data.title}」(申請番号 ${data.applicationNumber ?? "—"}, ${data.count}件, ¥${data.totalAmount?.toLocaleString()})`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "freee登録エラー");
    } finally {
      setSubmitting(false);
    }
  }

  const aiMatch = useCallback(
    async (
      rowsToMatch: TransactionRow[],
    ): Promise<{ rows: TransactionRow[] }> => {
      if (!me || !me.loggedIn) return { rows: rowsToMatch };
      const trips = rowsToMatch
        .filter((r) => r.date && r.from && r.to)
        .map((r) => ({
          id: r.id,
          date: r.date,
          time: r.time,
          from: r.from,
          to: r.to,
          amount: r.amount,
        }));
      if (trips.length === 0) return { rows: rowsToMatch };

      const res = await fetch("/api/calendar/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trips }),
      });
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 401) setMe({ loggedIn: false, freee: null });
        let detail = "";
        try {
          const errJson = JSON.parse(text) as { error?: string };
          if (errJson.error) detail = `: ${errJson.error}`;
        } catch {}
        const overloaded = /503|UNAVAILABLE|overload|high demand/i.test(detail);
        throw new Error(
          res.status === 504
            ? "AIマッチングが時間切れ（504）。件数を減らしてやり直してください"
            : overloaded
              ? "Gemini側が混雑中です。少し待ってから「AIで再マッチ」を押してください"
              : `マッチングに失敗 (${res.status})${detail}`,
        );
      }
      let data: {
        matches: Array<{
          tripId: string;
          eventId: string | null;
          summary: string | null;
          confidence: "high" | "medium" | "low";
          reason: string;
        }>;
        eventsByDate: Record<string, EventSuggestion[]>;
      };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("予期しないサーバー応答");
      }

      setEventsByDate((prev) => ({ ...prev, ...(data.eventsByDate ?? {}) }));
      const infoMap: Record<string, MatchInfo> = {};
      for (const m of data.matches ?? []) {
        infoMap[m.tripId] = {
          eventId: m.eventId,
          summary: m.summary,
          confidence: m.confidence,
          reason: m.reason,
        };
      }
      setMatchInfo((prev) => ({ ...prev, ...infoMap }));

      return {
        rows: rowsToMatch.map((r) => {
          if (r.purpose) return r;
          const m = infoMap[r.id];
          return m?.summary ? { ...r, purpose: m.summary } : r;
        }),
      };
    },
    [me],
  );

  useEffect(() => {
    if (!pendingSlackMatch) return;
    if (!me?.loggedIn) return;
    if (rows.length === 0) return;
    setPendingSlackMatch(false);
    (async () => {
      setMatching(true);
      try {
        const { rows: matched } = await aiMatch(rows);
        setRows((prev) => {
          const map = new Map(matched.map((r) => [r.id, r]));
          return prev.map((r) => map.get(r.id) ?? r);
        });
      } catch (e) {
        setWarning(e instanceof Error ? `AI連携: ${e.message}` : "AI連携に失敗");
      } finally {
        setMatching(false);
      }
    })();
  }, [pendingSlackMatch, me, rows, aiMatch]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setLoading(true);
    setError(null);
    setWarning(null);

    try {
      const allRows: TransactionRow[] = [];
      const failures: string[] = [];
      for (const file of Array.from(files)) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/parse", { method: "POST", body: formData });
          const text = await res.text();
          let data: (ParseResponse & { error?: string }) | null = null;
          try {
            data = JSON.parse(text) as ParseResponse & { error?: string };
          } catch {
            const hint =
              res.status === 504
                ? "解析が時間切れ（504）。1枚ずつアップロードしてみてください"
                : `サーバーエラー (${res.status})`;
            throw new Error(hint);
          }
          if (!res.ok) throw new Error(data?.error ?? "解析に失敗しました");
          allRows.push(...(data?.rows ?? []));
          if (data?.warning) setWarning(data.warning);
        } catch (e) {
          failures.push(`${file.name}: ${e instanceof Error ? e.message : "不明"}`);
        }
      }
      if (failures.length > 0) {
        setError(`一部の解析に失敗しました\n${failures.join("\n")}`);
      }

      let filteredRows = allRows;
      if (excludeHolidays) {
        const before = filteredRows.length;
        filteredRows = filteredRows.filter((r) => !isNonWorkingDay(r.date, holidays));
        const removed = before - filteredRows.length;
        if (removed > 0) {
          setWarning(`土日祝の ${removed} 件を自動で除外しました`);
        }
      }

      let newlyAdded: TransactionRow[] = [];
      setRows((prev) => {
        const { merged, addedCount } = appendUnique(prev, filteredRows);
        const skipped = filteredRows.length - addedCount;
        if (skipped > 0) {
          setWarning(`${addedCount} 件追加（重複 ${skipped} 件は除外）`);
        }
        newlyAdded = merged.slice(prev.length);
        return merged;
      });
      if (me?.loggedIn && newlyAdded.length > 0) {
        setMatching(true);
        try {
          const { rows: matched } = await aiMatch(newlyAdded);
          setRows((prev) => {
            const matchedById = new Map(matched.map((r) => [r.id, r]));
            return prev.map((r) => matchedById.get(r.id) ?? r);
          });
        } catch (e) {
          setWarning(e instanceof Error ? `AI連携: ${e.message}` : "AI連携に失敗");
        } finally {
          setMatching(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setLoading(false);
    }
  }

  async function rematchAll() {
    if (!me || !me.loggedIn || rows.length === 0) return;
    setMatching(true);
    setWarning(null);
    try {
      const cleared = rows.map((r) => ({ ...r, purpose: "" }));
      const { rows: matched } = await aiMatch(cleared);
      setRows(matched);
    } catch (e) {
      setWarning(e instanceof Error ? e.message : "再取得に失敗");
    } finally {
      setMatching(false);
    }
  }

  function updateRow(id: string, field: keyof TransactionRow, value: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, [field]: field === "amount" ? Number(value) || 0 : value }
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
      setEventsByDate({});
      setMatchInfo({});
      setError(null);
      setWarning(null);
    }
  }

  function downloadCsv() {
    if (filteredRows.length === 0) return;
    const header = ["日付", "時刻", "乗車駅", "降車駅", "金額", "用件"];
    const csv = [
      header.join(","),
      ...filteredRows.map((r) =>
        [r.date, r.time ?? "", r.from, r.to, r.amount, r.purpose ?? ""]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const tag = selectedMonth || new Date().toISOString().slice(0, 10);
    link.download = `suica-expense-${tag}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const totalAmount = filteredRows.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 sm:text-3xl">
              Suica 交通費取り込み
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              スクショ／PDFから交通費を読み取り、Googleカレンダーの予定とAIで紐付けます。
            </p>
          </div>
          <AuthBadge me={me} />
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
          {matching && !loading && (
            <p className="mt-4 text-center text-sm text-blue-600 dark:text-blue-400">
              AIがカレンダーと突き合わせ中...
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
          {me?.loggedIn === false && (
            <p className="mt-4 rounded-md bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              💡 Googleにログインすると、各交通費の「用件」をAIが自動で判断します。
            </p>
          )}

          <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={excludeHolidays}
                onChange={(e) => setExcludeHolidays(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
              />
              土日祝を自動除外（出勤日のみ取り込む）
            </label>
            <div className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <span>対象月：</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
              />
              <button
                type="button"
                onClick={() => setSelectedMonth("")}
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                title="月の絞り込みを解除"
              >
                全期間
              </button>
            </div>
          </div>
        </section>

        {rows.length > 0 && (
          <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
              <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {filteredRows.length} 件 / 合計
                  {isFiltered && (
                    <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-500">
                      （全{rows.length}件中）
                    </span>
                  )}
                </p>
                <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                  ¥{totalAmount.toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {me?.loggedIn && (
                  <button
                    onClick={rematchAll}
                    disabled={matching}
                    className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    🔁 AIで再マッチ
                  </button>
                )}
                <button
                  onClick={clearAll}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  クリア
                </button>
                <button
                  onClick={downloadCsv}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  CSV
                </button>
                {me?.loggedIn && me.freee?.connected && (
                  <button
                    onClick={submitToFreee}
                    disabled={submitting}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {submitting ? "送信中..." : "🟢 freeeに登録"}
                  </button>
                )}
              </div>
            </div>
            {submitResult && (
              <div className="mx-4 mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                ✅ {submitResult}
              </div>
            )}

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">日付</th>
                    <th className="px-3 py-2 font-medium">時刻</th>
                    <th className="px-3 py-2 font-medium">乗車駅</th>
                    <th className="px-3 py-2 font-medium">降車駅</th>
                    <th className="px-3 py-2 text-right font-medium">金額</th>
                    <th className="px-3 py-2 font-medium">用件</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={row.date}
                          onChange={(e) => updateRow(row.id, "date", e.target.value)}
                          className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="time"
                          value={row.time ?? ""}
                          onChange={(e) => updateRow(row.id, "time", e.target.value)}
                          className="w-24 rounded border border-transparent bg-transparent px-1 py-1 text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.from}
                          onChange={(e) => updateRow(row.id, "from", e.target.value)}
                          className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.to}
                          onChange={(e) => updateRow(row.id, "to", e.target.value)}
                          className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          value={row.amount}
                          onChange={(e) => updateRow(row.id, "amount", e.target.value)}
                          className="w-24 rounded border border-transparent bg-transparent px-1 py-1 text-right text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <PurposeCell
                          row={row}
                          events={eventsByDate[row.date] ?? []}
                          info={matchInfo[row.id]}
                          onChange={(value) => updateRow(row.id, "purpose", value)}
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

            {/* Mobile cards */}
            <ul className="divide-y divide-zinc-200 sm:hidden dark:divide-zinc-800">
              {filteredRows.map((row) => (
                <li key={row.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={row.date}
                        onChange={(e) => updateRow(row.id, "date", e.target.value)}
                        className="rounded border border-zinc-200 bg-transparent px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                      />
                      <input
                        type="time"
                        value={row.time ?? ""}
                        onChange={(e) => updateRow(row.id, "time", e.target.value)}
                        className="w-20 rounded border border-zinc-200 bg-transparent px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                      />
                    </div>
                    <button
                      onClick={() => deleteRow(row.id)}
                      className="text-xs text-red-600 hover:text-red-700 dark:text-red-400"
                      aria-label="削除"
                    >
                      削除
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.from}
                      onChange={(e) => updateRow(row.id, "from", e.target.value)}
                      placeholder="乗車駅"
                      className="flex-1 rounded border border-zinc-200 bg-transparent px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                    />
                    <span className="text-zinc-400">→</span>
                    <input
                      type="text"
                      value={row.to}
                      onChange={(e) => updateRow(row.id, "to", e.target.value)}
                      placeholder="降車駅"
                      className="flex-1 rounded border border-zinc-200 bg-transparent px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">¥</span>
                    <input
                      type="number"
                      value={row.amount}
                      onChange={(e) => updateRow(row.id, "amount", e.target.value)}
                      className="w-24 rounded border border-zinc-200 bg-transparent px-2 py-1 text-right text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                    />
                    <div className="flex-1">
                      <PurposeCell
                        row={row}
                        events={eventsByDate[row.date] ?? []}
                        info={matchInfo[row.id]}
                        onChange={(value) => updateRow(row.id, "purpose", value)}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function AuthBadge({ me }: { me: Me | null }) {
  if (me === null) {
    return <div className="text-xs text-zinc-400">確認中...</div>;
  }
  if (!me.loggedIn) {
    return (
      <a
        href="/api/auth/google/start"
        className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <GoogleIcon />
        Googleでログイン
      </a>
    );
  }
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 text-sm">
        {me.picture && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={me.picture}
            alt=""
            className="h-7 w-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="text-right">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {me.name ?? me.email}
          </div>
          <form action="/api/auth/google/logout" method="post" className="leading-none">
            <button
              type="submit"
              className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
            >
              ログアウト
            </button>
          </form>
        </div>
      </div>
      <FreeeAuthBadge freee={me.freee} />
    </div>
  );
}

function FreeeAuthBadge({ freee }: { freee: FreeeStatus | null }) {
  if (!freee?.connected) {
    return (
      <a
        href="/api/auth/freee/start"
        className="inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-sm transition hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
      >
        🟢 freeeを連携
      </a>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
      <span>✅ freee連携中{freee.userName ? `（${freee.userName}）` : ""}</span>
      <form action="/api/auth/freee/logout" method="post" className="leading-none">
        <button
          type="submit"
          className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
        >
          解除
        </button>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.99 8.99 0 0 0 9 0 9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

function ConfidenceBadge({ confidence }: { confidence: MatchInfo["confidence"] }) {
  const color =
    confidence === "high"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : confidence === "medium"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  const label = confidence === "high" ? "確実" : confidence === "medium" ? "中" : "低";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {label}
    </span>
  );
}

function PurposeCell({
  row,
  events,
  info,
  onChange,
}: {
  row: TransactionRow;
  events: EventSuggestion[];
  info?: MatchInfo;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const showBadge = info && row.purpose && info.summary && row.purpose === info.summary;

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const width = 288;
      const height = 256;
      const margin = 8;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top =
        spaceBelow >= height + margin
          ? rect.bottom + 4
          : Math.max(margin, rect.top - height - 4);
      const left = Math.min(
        Math.max(margin, rect.right - width),
        window.innerWidth - width - margin,
      );
      setPos({ top, left });
    }
    setOpen((v) => !v);
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={row.purpose ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="用件を入力"
        className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-zinc-900 hover:border-zinc-200 focus:border-blue-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
      />
      {showBadge && (
        <span title={info!.reason}>
          <ConfidenceBadge confidence={info!.confidence} />
        </span>
      )}
      {events.length > 0 && (
        <>
          <button
            ref={buttonRef}
            type="button"
            onClick={toggleOpen}
            className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label={`${events.length}件の予定から選択`}
            title={`${events.length}件の予定`}
          >
            📅
          </button>
          {open && pos && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setOpen(false)}
                aria-hidden="true"
              />
              <ul
                style={{ position: "fixed", top: pos.top, left: pos.left, width: 288 }}
                className="z-50 max-h-64 overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
              >
                {events.map((ev) => {
                  const isAiPick = info?.eventId === ev.id;
                  const time = ev.isAllDay
                    ? "終日"
                    : new Date(ev.start).toLocaleTimeString("ja-JP", {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                  return (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(ev.summary);
                          setOpen(false);
                        }}
                        className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 ${isAiPick ? "bg-blue-50/50 dark:bg-blue-950/30" : ""}`}
                      >
                        <span className="flex w-full items-center gap-2">
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {time}
                          </span>
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {ev.summary}
                          </span>
                          {isAiPick && (
                            <span className="ml-auto text-xs text-blue-600 dark:text-blue-400">
                              ✨ AI
                            </span>
                          )}
                        </span>
                        {ev.location && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            📍 {ev.location}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
