import { ensureFreshFreeeAuth } from "./freee-oauth";
import type { FreeeAuth } from "./session";

const API_BASE = "https://api.freee.co.jp";

export type ExpenseLine = {
  date: string;
  from: string;
  to: string;
  amount: number;
  purpose?: string;
};

type ExpenseApplicationLine = {
  description: string;
  amount: number;
  expense_application_line_template_id?: number;
};

type PurchaseLine = {
  transaction_date: string;
  expense_application_lines: ExpenseApplicationLine[];
};

type ExpenseApplicationCreated = {
  expense_application: {
    id: number;
    title: string;
    application_number?: string;
    total_amount: number;
  };
};

type LineTemplate = {
  id: number;
  name: string;
  account_item_id: number;
  account_item_name: string;
};

export async function fetchTransitTemplate(
  auth: FreeeAuth,
  companyId: number,
): Promise<{ id: number; name: string } | null> {
  const fresh = await ensureFreshFreeeAuth(auth);
  const res = await fetch(
    `${API_BASE}/api/1/expense_application_line_templates?company_id=${companyId}`,
    {
      headers: { Authorization: `Bearer ${fresh.accessToken}` },
    },
  );
  if (!res.ok) {
    throw new Error(
      `経費精算テンプレート取得失敗 (${res.status}): ${await res.text()}`,
    );
  }
  const data = (await res.json()) as {
    expense_application_line_templates?: LineTemplate[];
  };
  const list = data.expense_application_line_templates ?? [];
  const transit =
    list.find((t) => t.name.includes("交通費（日常）")) ??
    list.find((t) => t.account_item_name.includes("旅費交通費")) ??
    null;
  return transit ? { id: transit.id, name: transit.name } : null;
}

export async function createExpenseApplication(
  auth: FreeeAuth,
  companyId: number,
  options: {
    title: string;
    issueDate: string;
    rows: ExpenseLine[];
    templateId?: number;
  },
): Promise<ExpenseApplicationCreated["expense_application"]> {
  const fresh = await ensureFreshFreeeAuth(auth);

  const purchaseLines: PurchaseLine[] = options.rows.map((r) => ({
    transaction_date: r.date,
    expense_application_lines: [
      {
        description: buildDescription(r),
        amount: r.amount,
        expense_application_line_template_id: options.templateId,
      },
    ],
  }));

  const body = {
    company_id: companyId,
    title: options.title,
    issue_date: options.issueDate,
    description: "",
    purchase_lines: purchaseLines,
  };

  const res = await fetch(`${API_BASE}/api/1/expense_applications`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fresh.accessToken}`,
      "Content-Type": "application/json",
      "X-Api-Version": "2020-06-15",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`経費精算申請の作成失敗 (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as ExpenseApplicationCreated;
  return data.expense_application;
}

function buildDescription(r: ExpenseLine): string {
  const route = `${r.from}〜${r.to}`;
  return r.purpose ? `${route} (${r.purpose})` : route;
}
