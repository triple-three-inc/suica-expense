import { NextResponse } from "next/server";
import { after } from "next/server";
import {
  verifySlackSignature,
  postSlackMessage,
  downloadSlackFile,
} from "@/lib/slack";
import { parseImageToTransactions } from "@/lib/parse-image";
import { encryptHandoff } from "@/lib/handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SlackFile = {
  id: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
};

type SlackMessageEvent = {
  type: "message";
  channel: string;
  user?: string;
  ts: string;
  thread_ts?: string;
  files?: SlackFile[];
  bot_id?: string;
  subtype?: string;
  text?: string;
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const ts = request.headers.get("x-slack-request-timestamp") ?? "";
  const sig = request.headers.get("x-slack-signature") ?? "";

  if (!verifySlackSignature(ts, sig, rawBody)) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  let body: { type?: string; challenge?: string; event?: SlackMessageEvent };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  const event = body.event;
  if (event && event.type === "message" && !event.bot_id && event.subtype !== "bot_message") {
    after(() => handleMessage(event));
  }

  return new NextResponse("ok", { status: 200 });
}

function isPdfFile(f: SlackFile): boolean {
  if ((f.mimetype ?? "").includes("pdf")) return true;
  return /\.pdf$/i.test(f.name ?? "");
}

function isImageFile(f: SlackFile): boolean {
  if ((f.mimetype ?? "").startsWith("image/")) return true;
  return /\.(png|jpe?g|heic|heif|webp)$/i.test(f.name ?? "");
}

async function handleMessage(event: SlackMessageEvent) {
  try {
    const files = (event.files ?? []).filter((f) => isPdfFile(f) || isImageFile(f));

    if (files.length === 0) {
      if (event.text && event.text.length > 0) {
        await postSlackMessage(
          event.channel,
          "Suicaのスクショ画像（PNG/JPG/HEIC）またはPDFを送ってください。複数ファイルOKです。",
          { thread_ts: event.ts },
        );
      }
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await postSlackMessage(
        event.channel,
        "サーバー設定エラー: GEMINI_API_KEY が未設定です",
        { thread_ts: event.ts },
      );
      return;
    }

    const allRows = [];
    const failures: string[] = [];

    for (const f of files) {
      try {
        const url = f.url_private_download ?? f.url_private;
        if (!url) throw new Error("ファイルのダウンロードURLが取得できませんでした");
        const { buffer, mimeType } = await downloadSlackFile(url);
        if (isPdfFile(f)) {
          const { parsePdfToTransactions } = await import("@/lib/parse-pdf");
          const rows = await parsePdfToTransactions(buffer, f.name ?? "file.pdf");
          allRows.push(...rows);
        } else {
          const fileObj = new File([buffer as BlobPart], f.name ?? "image.png", {
            type: f.mimetype ?? mimeType,
          });
          const rows = await parseImageToTransactions(fileObj, apiKey);
          allRows.push(...rows);
        }
      } catch (e) {
        failures.push(`${f.name ?? f.id}: ${e instanceof Error ? e.message : "不明"}`);
      }
    }

    if (allRows.length === 0) {
      const failHint =
        failures.length > 0 ? `\n失敗:\n${failures.join("\n")}` : "";
      await postSlackMessage(
        event.channel,
        `交通費の行が見つかりませんでした。${failHint}`,
        { thread_ts: event.ts },
      );
      return;
    }

    const token = encryptHandoff(allRows, event.user);
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ??
      process.env.GOOGLE_REDIRECT_URI?.replace(/\/api\/auth\/.*/, "") ??
      "https://suica-expense-333.vercel.app";
    const link = `${baseUrl}/?slack=${token}`;

    const total = allRows.reduce((s, r) => s + r.amount, 0);
    const summary = allRows
      .slice(0, 5)
      .map(
        (r) =>
          `• ${r.date} ${r.from}→${r.to} ¥${r.amount.toLocaleString()}`,
      )
      .join("\n");
    const more = allRows.length > 5 ? `\n…他 ${allRows.length - 5} 件` : "";
    const failNote =
      failures.length > 0 ? `\n\n⚠️ 一部失敗:\n${failures.join("\n")}` : "";

    await postSlackMessage(
      event.channel,
      `${allRows.length}件読み取りました（合計 ¥${total.toLocaleString()}）\n${summary}${more}${failNote}\n\nレビュー・freee登録 → ${link}`,
      { thread_ts: event.ts },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    await postSlackMessage(event.channel, `エラー: ${message}`, {
      thread_ts: event.ts,
    });
  }
}
