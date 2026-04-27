export type TransactionRow = {
  id: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  purpose?: string;
};

export type ParseResponse = {
  rows: TransactionRow[];
  warning?: string;
};
