export type Customer = {
  id: string;
  name: string;
  display_order: number;
};

export type CustomerSummary = {
  customerId: string;
  sales: number;
  units: number;
  transactions: number;
  latestDate: string | null;
  earliestDate: string | null;
  latestMonth: string | null;
  months: string[];
};
