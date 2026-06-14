export type SnapshotMetricSet = {
  sales: number;
  units: number;
  transactions: number;
};

export type SnapshotSalesMixSlice = {
  name: string;
  units: number;
  percent: number;
};

export type SnapshotBestDayItem = {
  rank: number;
  style: string;
  color: string;
  artCode: string;
  sales: number;
  units: number;
  transactions: number;
};

export type SnapshotBestDay = {
  date: string | null;
  sales: number;
  units: number;
  transactions: number;
  dayCount?: number;
  items: SnapshotBestDayItem[];
};

export type SnapshotTopStyle = SnapshotMetricSet & {
  rank: number;
  style: string;
  brand: string;
  colorCount: number;
  artCount: number;
  priorUnits: number;
  priorSales: number;
  priorColorCount: number;
  priorArtCount: number;
};

export type SnapshotTopArt = SnapshotMetricSet & {
  rank: number;
  key: string;
  style: string;
  brand: string;
  styleName: string;
  color: string;
  artCode: string;
  cySales: number;
  cyUnits: number;
  inventoryUnits?: number | null;
  imageUrl: string | null;
};

export type SnapshotYtdLine = {
  current: number[];
  prior: number[];
  currentTotal: number;
  priorTotal: number;
};

export type SnapshotYtdInsights = {
  averageMonthlySales: number;
  priorAverageMonthlySales: number;
  stylesSold: number;
  priorStylesSold: number;
  colorsSold: number;
  priorColorsSold: number;
  artworksSold: number;
  priorArtworksSold: number;
};

export type ReportSnapshotPayload = {
  version: 1;
  generatedAt: string;
  accountName: string;
  brandFilter: string;
  periodMode?: "monthly" | "ytd";
  selectedMonth: string | null;
  periodTitle: string;
  priorPeriodTitle: string;
  previousMonthTitle?: string;
  lastUploaded: string | null;
  currentMetrics: SnapshotMetricSet;
  priorMetrics: SnapshotMetricSet;
  ytdLine: SnapshotYtdLine;
  ytdInsights?: SnapshotYtdInsights;
  salesMix: SnapshotSalesMixSlice[];
  bestDay: SnapshotBestDay;
  topStyles: SnapshotTopStyle[];
  styleStudyMonthly?: SnapshotTopStyle[];
  styleStudyYtd?: SnapshotTopStyle[];
  topArt: SnapshotTopArt[];
  allStyles: SnapshotTopStyle[];
};

export type ReportSnapshotRecord = {
  token: string;
  title: string;
  payload: ReportSnapshotPayload;
  created_at: string;
  expires_at: string | null;
};

export function isReportSnapshotPayload(value: unknown): value is ReportSnapshotPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "version" in value &&
      "accountName" in value &&
      "currentMetrics" in value,
  );
}
