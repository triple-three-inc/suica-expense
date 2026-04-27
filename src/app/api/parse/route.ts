import { NextResponse } from "next/server";
import { parsePdfToTransactions } from "@/lib/parse-pdf";
import { parseImageToTransactions } from "@/lib/parse-image";
import type { ParseResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "file フィールドが必要です" },
        { status: 400 },
      );
    }

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    const isImage =
      file.type.startsWith("image/") ||
      /\.(png|jpe?g|heic|heif|webp)$/i.test(file.name);

    if (isPdf) {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const rows = await parsePdfToTransactions(buffer, file.name);
      const response: ParseResponse = {
        rows,
        warning:
          rows.length === 0 ? "交通費の行が見つかりませんでした" : undefined,
      };
      return NextResponse.json(response);
    }

    if (isImage) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: "GEMINI_API_KEY が設定されていません" },
          { status: 500 },
        );
      }
      const rows = await parseImageToTransactions(file, apiKey);
      const response: ParseResponse = {
        rows,
        warning:
          rows.length === 0 ? "交通費の行が見つかりませんでした" : undefined,
      };
      return NextResponse.json(response);
    }

    return NextResponse.json(
      { error: "対応していないファイル形式です（PDF または画像のみ）" },
      { status: 400 },
    );
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "不明なエラー";
    return NextResponse.json(
      { error: `解析中にエラーが発生しました: ${message}` },
      { status: 500 },
    );
  }
}
