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
  inventoryScope?: "color" | "styleArt" | null;
  imageUrl: string | null;
  productUrl?: string | null;
};

export type SnapshotYtdLine = {
  current: number[];
  prior: number[];
  currentTotal: number;
  priorTotal: number;
};

export type SnapshotInventoryLine = {
  current: Array<number | null>;
  prior: Array<number | null>;
  currentYear: number;
  priorYear: number;
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

export type SnapshotMonthlyDrivers = {
  avgSalePerTransaction: number;
  priorAvgSalePerTransaction: number;
  avgSalePerUnit: number;
  priorAvgSalePerUnit: number;
  stylesSold: number;
  priorStylesSold: number;
  colorsSold: number;
  priorColorsSold: number;
  artworksSold: number;
  priorArtworksSold: number;
  topFiveStyleSales: number;
  topFiveStyleShare: number;
};

export type SnapshotWeeklyScorecardRow = {
  rank: number;
  title: string;
  dateRange: string;
  dayCount: number;
  current: SnapshotMetricSet;
  prior: SnapshotMetricSet;
  avgSalePerTransaction: number;
  breadth: {
    styles: number;
    colors: number;
    artworks: number;
  };
  priorBreadth: {
    styles: number;
    colors: number;
    artworks: number;
  };
  topItem: {
    style: string;
    artCode: string;
    color: string;
    units: number;
    sales: number;
    imageUrl: string | null;
  } | null;
  topItems?: {
    style: string;
    artCode: string;
    color: string;
    units: number;
    sales: number;
    imageUrl: string | null;
  }[];
};

export type SnapshotInventory = {
  date: string;
  totalUnits: number;
  styles: number;
  artworks: number;
  coverage: number | null;
  line?: SnapshotInventoryLine | null;
  byBrand: { brand: string; units: number }[];
  topStyles: { style: string; brand: string; units: number; artworks: number }[];
} | null;

export type SnapshotInventoryTrackerItem = {
  rank: number;
  key: string;
  style: string;
  brand: string;
  color: string;
  artCode: string;
  ytdUnits?: number;
  inventoryUnits: number;
  imageUrl: string | null;
  productUrl?: string | null;
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
  monthlyDrivers?: SnapshotMonthlyDrivers;
  weeklyScorecards?: SnapshotWeeklyScorecardRow[];
  inventorySnapshot?: SnapshotInventory;
  inventoryTrackerSort?: "highest" | "lowest";
  inventoryTracker?: SnapshotInventoryTrackerItem[];
  salesMix: SnapshotSalesMixSlice[];
  bestDay: SnapshotBestDay;
  topStyles: SnapshotTopStyle[];
  styleStudyMonthly?: SnapshotTopStyle[];
  styleStudyYtd?: SnapshotTopStyle[];
  topArt: SnapshotTopArt[];
};

export type ReportSnapshotBundlePayload = {
  version: 1;
  reportKind: "account_bundle";
  generatedAt: string;
  accountName: string;
  brandFilter: string;
  periodMode?: "monthly" | "ytd";
  selectedMonth: string | null;
  periodTitle: string;
  priorPeriodTitle: string;
  reports: ReportSnapshotPayload[];
};

export type ShareSnapshotPayload = ReportSnapshotPayload | ReportSnapshotBundlePayload;

export type ReportSnapshotRecord = {
  token: string;
  title: string;
  payload: ShareSnapshotPayload;
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

export function isReportSnapshotBundlePayload(value: unknown): value is ReportSnapshotBundlePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const payload = value as {
    reportKind?: unknown;
    reports?: unknown;
    version?: unknown;
  };

  return (
    payload.version === 1 &&
    payload.reportKind === "account_bundle" &&
    Array.isArray(payload.reports) &&
    payload.reports.every(isReportSnapshotPayload)
  );
}

export function isShareSnapshotPayload(value: unknown): value is ShareSnapshotPayload {
  return isReportSnapshotPayload(value) || isReportSnapshotBundlePayload(value);
}
