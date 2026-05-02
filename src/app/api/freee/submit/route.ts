import { NextResponse } from "next/server";
import { getSession, updateFreeeAuth } from "@/lib/session";
import {
  createExpenseApplication,
  fetchTransitTemplate,
  type ExpenseLine,
} from "@/lib/freee-expense";
import { fetchFreeeMe } from "@/lib/freee-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  title?: string;
  issueDate?: string;
  rows: Array<{
    date: string;
    from: string;
    to: string;
    amount: number;
    purpose?: string;
  }>;
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not_logged_in" }, { status: 401 });
  }
  if (!session.freee) {
    return NextResponse.json({ error: "freee_not_connected" }, { status: 401 });
  }
  let companyId = session.freee.companyId;
  if (!companyId) {
    try {
      const me = await fetchFreeeMe(session.freee.accessToken);
      const fallback =
        me.user.companies?.find((c) => c.default_company) ?? me.user.companies?.[0];
      if (fallback?.id) {
        companyId = fallback.id;
        await updateFreeeAuth({ ...session.freee, companyId });
      }
    } catch {}
    if (!companyId) {
      return NextResponse.json(
        {
          error:
            "freeeの会社IDが取得できません。freeeに会社が紐付いているか確認し、画面右上の「解除」→ 再連携してください",
        },
        { status: 400 },
      );
    }
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rows: ExpenseLine[] = (body.rows ?? []).filter(
    (r): r is ExpenseLine =>
      typeof r.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
      typeof r.from === "string" &&
      typeof r.to === "string" &&
      typeof r.amount === "number" &&
      r.amount > 0,
  );

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "登録できる行がありません（金額が0または駅名が空）" },
      { status: 400 },
    );
  }

  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const titleMonth = rows[0].date.slice(0, 7);
  const title = body.title?.trim() || `交通費 ${titleMonth}`;
  const issueDate = body.issueDate ?? todayISO;

  try {
    const template = await fetchTransitTemplate(session.freee, companyId);
    const created = await createExpenseApplication(
      session.freee,
      companyId,
      {
        title,
        issueDate,
        rows,
        templateId: template?.id,
      },
    );

    return NextResponse.json({
      ok: true,
      id: created.id,
      title: created.title,
      applicationNumber: created.application_number,
      totalAmount: created.total_amount,
      templateUsed: template?.name ?? null,
      count: rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
