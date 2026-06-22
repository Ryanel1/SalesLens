import { monthText, numberText } from "@/lib/formatters";
import type { InventoryRecord, MerchandiseRecord, ProductImage, SalesRecord, UploadRecord } from "@/lib/reportData";
import type { ReportSnapshotPayload, SnapshotSalesForecast } from "@/lib/reportSnapshot";

type RebelRagsImageMatch = {
  style: string;
  artCode: string;
  color: string;
  productUrl: string;
  imageUrl: string;
  sourceImageUrl?: string;
  storagePath?: string | null;
  lookupArtCode: string;
  isManualOverride: boolean;
};

type ImageFetchCandidate = {
  style: string;
  artCode: string;
  color: string;
  styleName: string;
  parentSku: string | null;
  sku: string | null;
  imageUrl: string | null;
};

export type MetricSet = {
  sales: number;
  units: number;
  transactions: number;
};

export type WeeklyTopItem = {
  style: string;
  color: string;
  artCode: string;
  sales: number;
  units: number;
  imageUrl: string | null;
};

export type TopArt = MetricSet & {
  rank: number;
  key: string;
  style: string;
  brand: string;
  styleName: string;
  color: string;
  artCode: string;
  parentSku: string | null;
  sku: string | null;
  cySales: number;
  cyUnits: number;
  inventoryUnits: number | null;
  inventoryScope: "color" | null;
  imageUrl: string | null;
  productUrl: string | null;
};

export type InventoryTrackerItem = {
  rank: number;
  key: string;
  style: string;
  brand: string;
  styleName: string;
  color: string;
  artCode: string;
  parentSku: string | null;
  sku: string | null;
  audience: InventoryAudience;
  productCategory: InventoryProductCategory;
  ytdUnits: number;
  priorYearUnits: number | null;
  recentSixMonthUnits: number;
  inventoryUnits: number;
  imageUrl: string | null;
  productUrl: string | null;
};

export type InventorySort = "highest" | "lowest";
export type InventoryAudience = "Unisex" | "Womens" | "Mens" | "Youth";
export type InventoryAudienceFilter = "All" | "Mens" | "Womens" | "Youth";
export type InventoryProductCategory = "Fleece" | "Reverse Weave" | "Tees" | "Other";
export type InventoryProductFilter = "Fleece" | "Reverse Weave" | "Tees" | "Namedrop";
export type TopArtSort = "units" | "dollars";
export type InventoryTrackerMeta = {
  totalItems: number;
  totalUnits: number;
  page: number;
  pageSize: number;
  pageCount: number;
  pageStart: number;
  pageEnd: number;
  sort: InventorySort;
  audienceFilter: InventoryAudienceFilter;
  productFilters: InventoryProductFilter[];
};

export type TopStyle = MetricSet & {
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

export type BreadthMetrics = {
  styles: number;
  colors: number;
  artworks: number;
};

export type WeeklyScorecardRow = {
  rank: number;
  title: string;
  dateRange: string;
  dayCount: number;
  current: MetricSet;
  prior: MetricSet;
  avgSalePerTransaction: number;
  breadth: BreadthMetrics;
  priorBreadth: BreadthMetrics;
  topItem: {
    style: string;
    artCode: string;
    color: string;
    units: number;
    sales: number;
    imageUrl: string | null;
  } | null;
  topItems: WeeklyTopItem[];
};

export type PeriodSelection =
  | { kind: "month"; value: string; year: number }
  | { kind: "year"; value: string; year: number };

export type SalesMixSlice = {
  name: string;
  units: number;
  percent: number;
};

export type InventoryLine = {
  current: Array<number | null>;
  prior: Array<number | null>;
  currentYear: number;
  priorYear: number;
};

export type InventoryPosition = {
  score: number;
  label: "Lean" | "Balanced" | "Heavy";
  headline: string;
  detail: string;
  comparison: string;
};

export type InventorySnapshot = {
  date: string;
  totalUnits: number;
  styles: number;
  artworks: number;
  coverage: number | null;
  line: InventoryLine | null;
  position: InventoryPosition;
  byBrand: { brand: string; units: number }[];
  topStyles: { style: string; brand: string; units: number; artworks: number }[];
} | null;


const INVENTORY_TRACKER_MIN_UNITS = 5;
const INVENTORY_TRACKER_RECENT_DEMAND_UNITS = 25;
const IMAGE_PREFETCH_RECORD_GROUP_LIMIT = 30;
const INVENTORY_TRACKER_PAGE_SIZE = 50;
const INVENTORY_AUDIENCE_FILTERS: InventoryAudienceFilter[] = ["Mens", "Womens", "Youth"];
const INVENTORY_PRODUCT_FILTERS: InventoryProductFilter[] = ["Fleece", "Tees", "Reverse Weave", "Namedrop"];
const REBEL_RAGS_NAMEDROP_CT1000_ARTS = new Set([
  "00367241",
  "03491635",
  "03503264",
  "03503316",
  "03503317",
  "03503347",
  "03503350",
  "03503351",
  "03503432",
  "03661320",
  "03687238",
  "03687242",
  "03687253",
  "03687254",
  "03687256",
  "03687272",
  "03687276",
  "03687288",
  "03751691",
  "03751742",
  "03751856",
  "03751860",
  "03751861",
  "03751866",
  "03751911",
  "03751913",
  "03751915",
  "03751916",
  "03751966",
  "03752042",
  "03804603",
  "03804604",
  "03804605",
  "03854968",
  "03884278",
]);
const GEAR_STYLE_PREFIXES = ["GDH", "G", "C400", "C603", "S650", "G209"];
const INVENTORY_FLEECE_STYLES = new Set([
  "CS1220",
  "CS2070",
  "CS2071",
  "CP2028",
  "CP2071",
  "CP2081",
  "C4002",
  "C4003",
  "C4005",
  "G1092",
  "G1093",
  "G1495",
  "G2099",
  "G3153",
  "G3156",
  "G3158",
  "G3159",
  "G4001",
  "G4003",
  "G4017",
  "G7134",
  "G7143",
  "G7146",
  "G7149",
  "G715",
  "G7154",
  "G7155",
  "G7156",
  "G7158",
  "G7394",
  "GDH200",
  "GDH400",
  "GDH450",
]);
const INVENTORY_FLEECE_STYLE_PREFIXES = ["C400"];
const INVENTORY_REVERSE_WEAVE_STYLES = new Set(["CS3050", "CS3051"]);
const INVENTORY_TEE_STYLES = new Set([
  "CT1000",
  "CT1081",
  "CT1730",
  "C6036",
  "C6039",
  "C6047",
  "C6048",
  "C6054",
  "C7006",
  "G1357",
  "G2327",
  "G3154",
  "G3155",
  "G3157",
  "G7371",
  "G7372",
  "G7382",
  "G7391",
  "G7392",
  "G7393",
  "G7396",
  "GDH100",
  "GDH135",
]);
const INVENTORY_TEE_STYLE_PREFIXES = ["C603"];
const KNOWN_STYLE_PREFIXES = [
  "CS1220",
  "CT1000",
  "CS3050",
  "CS3051",
  "CS3055",
  "CS2070",
  "CS2071",
  "CS2083",
  "CP2028",
  "CP2071",
  "CP2081",
  "C4002",
  "C4003",
  "C4005",
  "C6036",
  "C6039",
  "C6047",
  "C6048",
  "C6054",
  "C7006",
  "C81001",
  "C81003",
  "CT1081",
  "CT1730",
  "GDH1000",
  "GDH100",
  "GDH135",
  "GDH200",
  "GDH400",
  "GDH450",
  "G1092",
  "G1093",
  "G1357",
  "G1495",
  "G2099",
  "G2327",
  "G3153",
  "G3154",
  "G3155",
  "G3156",
  "G3157",
  "G3158",
  "G3159",
  "G3161",
  "G4001",
  "G4003",
  "G4017",
  "G7134",
  "G7143",
  "G7146",
  "G7149",
  "G7154",
  "G7155",
  "G7156",
  "G7158",
  "G715",
  "G7371",
  "G7372",
  "G7382",
  "G7392",
  "G7393",
  "G7394",
  "G7396",
  "G7391",
  "P940",
  "S760",
];


export function buildReportPayload({
  accountName,
  brandFilter,
  generatedAt,
  inventoryAudienceFilter = "All",
  inventoryPage = 1,
  inventoryPageSize = INVENTORY_TRACKER_PAGE_SIZE,
  inventoryProductFilters = [],
  images,
  inventoryRecords,
  inventorySort = "highest",
  period,
  records,
  topArtSort = "units",
  uploads = [],
}: {
  accountName: string;
  brandFilter: string;
  generatedAt: string;
  inventoryAudienceFilter?: InventoryAudienceFilter;
  inventoryPage?: number;
  inventoryPageSize?: number;
  inventoryProductFilters?: InventoryProductFilter[];
  images: ProductImage[];
  inventoryRecords: InventoryRecord[];
  inventorySort?: InventorySort;
  period: PeriodSelection;
  records: SalesRecord[];
  topArtSort?: TopArtSort;
  uploads?: UploadRecord[];
}): ReportSnapshotPayload {
  const filteredRecords = records.filter((record) => brandFilter === "All" || brandName(record) === brandFilter);
  const filteredInventoryRecords = inventoryRecords.filter((record) => brandFilter === "All" || brandName(record) === brandFilter);
  const periodEndMonth = period.kind === "month" ? period.value : latestMonthForYear(filteredRecords, period.year);
  const priorYearMonth = periodEndMonth ? `${period.year - 1}${periodEndMonth.slice(4)}` : null;
  const periodRecords = recordsForSelectedPeriod(filteredRecords, period);
  const priorPeriodRecords = recordsForPriorPeriod(filteredRecords, period, periodRecords);
  const ytdCurrentRecords =
    period.kind === "month"
      ? currentYtdRecordsForPeriod(filteredRecords, periodEndMonth, periodRecords)
      : currentYearRecords(filteredRecords, periodEndMonth);
  const ytdPriorRecords =
    period.kind === "month"
      ? priorYtdRecordsForPeriod(filteredRecords, periodEndMonth, periodRecords)
      : priorYearMonth
        ? currentYearRecords(filteredRecords, priorYearMonth)
        : [];
  const priorYearRecords = recordsForYear(filteredRecords, period.year - 1);
  const currentMetrics = metricSet(periodRecords);
  const priorMetrics = metricSet(priorPeriodRecords);
  const selectedPeriodTitle = periodTitle(period, periodEndMonth, periodRecords);
  const priorPeriodTitle = priorTitle(period, periodEndMonth, periodRecords, filteredRecords);
  const bestDay = bestSalesDay(periodRecords, images);
  const ytdStyleStudy = topStyleRows(ytdCurrentRecords, ytdPriorRecords);
  const inventoryTrackerResult = pagedInventoryTrackerRows({
    contextRecords: filteredRecords,
    images,
    inventoryAudienceFilter,
    inventoryPage,
    inventoryPageSize,
    inventoryProductFilters,
    periodEndMonth,
    periodRecords,
    priorYearRecords,
    sort: inventorySort,
    standaloneInventoryRecords: filteredInventoryRecords,
    ytdCurrentRecords,
  });

  return {
    version: 1,
    generatedAt,
    accountName,
    brandFilter,
    periodMode: period.kind === "month" ? "monthly" : "ytd",
    selectedMonth: periodEndMonth,
    periodTitle: selectedPeriodTitle,
    priorPeriodTitle,
    previousMonthTitle: priorPeriodTitle,
    topArtSort,
    lastUploaded: latestDate(filteredRecords),
    currentMetrics,
    priorMetrics,
    ytdLine: ytdPoints(filteredRecords, periodEndMonth, period.kind === "month" ? periodRecords : []),
    ytdInsights: ytdInsightMetrics(ytdCurrentRecords, ytdPriorRecords, periodEndMonth),
    salesForecast: salesForecastMetrics(filteredRecords, periodEndMonth),
    monthlyDrivers: monthlyDriverMetrics(periodRecords, priorPeriodRecords),
    weeklyScorecards: period.kind === "month" ? weeklyScorecardRows(filteredRecords, periodEndMonth, images, uploads) : [],
    inventorySnapshot: inventorySnapshotForRecords(periodRecords, filteredInventoryRecords, periodEndMonth, filteredRecords),
    inventoryTrackerSort: inventorySort,
    inventoryTrackerMeta: inventoryTrackerResult.meta,
    inventoryTracker: inventoryTrackerResult.rows,
    salesMix: salesMixSlices(periodRecords),
    bestDay: {
      date: bestDay.date,
      sales: bestDay.sales,
      units: bestDay.units,
      transactions: bestDay.transactions,
      dayCount: bestDay.dayCount,
      items: bestDay.items,
    },
    topStyles: ytdStyleStudy,
    styleStudyMonthly: topStyleRows(periodRecords, priorPeriodRecords),
    styleStudyYtd: ytdStyleStudy,
    topArt: topArtRows(periodRecords, ytdCurrentRecords, images, filteredInventoryRecords, topArtSort),
  };
}

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function uniqueCount(values: string[]) {
  return new Set(values.filter(Boolean).map((value) => value.toUpperCase())).size;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function sortBySales(left: MetricSet, right: MetricSet) {
  return right.sales - left.sales || right.units - left.units;
}

function sortByUnits(left: MetricSet, right: MetricSet) {
  return right.units - left.units || right.sales - left.sales;
}

function sortWeeklyTopItems(left: WeeklyTopItem, right: WeeklyTopItem) {
  return right.units - left.units || right.sales - left.sales;
}

function firstNonBlank(values: Array<string | null | undefined>) {
  return values.map(clean).find(Boolean) ?? null;
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfMondayWeek(date: Date) {
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

function endOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function maxDate(left: Date, right: Date) {
  return left > right ? left : right;
}

function minDate(left: Date, right: Date) {
  return left < right ? left : right;
}

function daysBetween(startDate: Date, endDate: Date) {
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
}

function dateRangeText(startDate: Date, endDate: Date) {
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  const startText = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(startDate);
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const sameMonth = sameYear && startDate.getUTCMonth() === endDate.getUTCMonth();
  const endOptions: Intl.DateTimeFormatOptions = sameMonth
    ? { day: "numeric", timeZone: "UTC" }
    : sameYear
      ? { month: "short", day: "numeric", timeZone: "UTC" }
      : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  const endText = new Intl.DateTimeFormat("en-US", endOptions).format(endDate);
  const yearText = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "UTC" }).format(endDate);
  if (start === end) return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(startDate);
  return `${startText}-${endText}, ${yearText}`;
}

function availableMonths(records: SalesRecord[]) {
  return [...new Set(records.map((record) => monthKey(record.transaction_date)).filter((month): month is string => Boolean(month)))]
    .sort()
    .reverse();
}

function availableYears(records: SalesRecord[]) {
  return [...new Set(records.map((record) => monthKey(record.transaction_date)?.slice(0, 4)).filter((year): year is string => Boolean(year)))]
    .sort()
    .reverse();
}

function defaultPeriodValue(records: SalesRecord[]) {
  const month = availableMonths(records)[0];
  return month ? `month:${month}` : null;
}

function periodOptionGroups(months: string[], years: string[]) {
  return [
    {
      label: "Monthly",
      options: months.map((month) => ({ value: `month:${month}`, label: monthText(month) })),
    },
    {
      label: "Full Year / YTD",
      options: years.map((year) => ({ value: `year:${year}`, label: yearLabel(Number(year)) })),
    },
  ].filter((group) => group.options.length > 0);
}

function parsePeriodValue(value: string): PeriodSelection | null {
  const [kind, rawValue] = value.split(":");
  if (kind === "month" && /^\d{4}-\d{2}$/.test(rawValue)) {
    return { kind, value: rawValue, year: Number(rawValue.slice(0, 4)) };
  }
  if (kind === "year" && /^\d{4}$/.test(rawValue)) {
    return { kind, value: rawValue, year: Number(rawValue) };
  }
  return null;
}

function periodTitle(period: PeriodSelection | null, endMonth: string | null, periodRecords: SalesRecord[] = []) {
  if (!period) return "-";
  if (period.kind === "month") {
    const range = recordDateRange(periodRecords);
    return range ? comparisonRangeTitle(range.startDate, range.endDate, period.value) : monthText(period.value);
  }
  return yearLabel(period.year, endMonth);
}

function priorTitle(period: PeriodSelection | null, endMonth: string | null, periodRecords: SalesRecord[] = [], records: SalesRecord[] = []) {
  if (!period) return "-";
  if (period.kind === "month") {
    const priorMonth = `${period.year - 1}${period.value.slice(4)}`;
    if (records.length) {
      const comparison = priorPeriodComparison(records, period, periodRecords);
      if (comparison.usesFullMonth) return monthText(priorMonth);
    }
    const range = priorYearComparisonRange(period, periodRecords);
    return range ? comparisonRangeTitle(range.startDate, range.endDate, priorMonth) : monthText(priorMonth);
  }
  return yearLabel(period.year - 1, endMonth ? `${period.year - 1}${endMonth.slice(4)}` : null);
}

function recordDateRange(records: SalesRecord[]) {
  const dates = records.map((record) => record.transaction_date).filter((date): date is string => Boolean(date)).sort();
  if (!dates.length) return null;
  return { startDate: dates[0], endDate: dates[dates.length - 1] };
}

function comparisonRangeTitle(startDate: string, endDate: string, month: string) {
  return isFullMonthRange(startDate, endDate, month) ? monthText(month) : dateRangeText(parseDate(startDate), parseDate(endDate));
}

function isFullMonthRange(startDate: string, endDate: string, month: string) {
  return startDate === `${month}-01` && endDate === dateKey(endOfMonth(parseDate(`${month}-01`)));
}

function sameMonthDayInYear(date: string, year: number) {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function priorYearComparisonRange(period: PeriodSelection, periodRecords: SalesRecord[]) {
  if (period.kind !== "month") return null;
  const range = recordDateRange(periodRecords);
  if (!range) return null;
  return {
    startDate: sameMonthDayInYear(range.startDate, period.year - 1),
    endDate: sameMonthDayInYear(range.endDate, period.year - 1),
  };
}

function yearLabel(year: number, endMonth?: string | null) {
  const currentYear = new Date().getFullYear();
  if (year >= currentYear) return `${year} YTD`;
  return `${year} Full Year`;
}

function latestMonthForYear(records: SalesRecord[], year: number) {
  return availableMonths(records).filter((month) => month.startsWith(`${year}-`))[0] ?? `${year}-12`;
}

function recordsForSelectedPeriod(records: SalesRecord[], period: PeriodSelection) {
  if (period.kind === "month") return recordsForPeriod(records, period.value, "monthly");
  return recordsForYear(records, period.year);
}

function recordsForPriorPeriod(records: SalesRecord[], period: PeriodSelection, periodRecords: SalesRecord[] = []) {
  if (period.kind === "month") {
    return priorPeriodComparison(records, period, periodRecords).records;
  }
  return recordsForYear(records, period.year - 1);
}

function priorPeriodComparison(records: SalesRecord[], period: PeriodSelection, periodRecords: SalesRecord[] = []) {
  const priorMonth = `${period.year - 1}${period.value.slice(4)}`;
  const fullMonthRecords = recordsForPeriod(records, priorMonth, "monthly");
  const range = priorYearComparisonRange(period, periodRecords);
  if (!range) return { records: fullMonthRecords, range: null, usesFullMonth: true };

  const rangeRecords = recordsForDateRange(records, range.startDate, range.endDate);
  if (rangeRecords.length || !fullMonthRecords.length) {
    return { records: rangeRecords, range, usesFullMonth: false };
  }

  return { records: fullMonthRecords, range: null, usesFullMonth: true };
}

function recordsForYear(records: SalesRecord[], year: number) {
  return records.filter((record) => monthKey(record.transaction_date)?.slice(0, 4) === String(year));
}

function recordsForPeriod(records: SalesRecord[], month: string, periodMode: "monthly" | "ytd") {
  return records.filter((record) => {
    const recordMonth = monthKey(record.transaction_date);
    if (!recordMonth) return false;
    if (periodMode === "monthly") return recordMonth === month;
    return recordMonth.slice(0, 4) === month.slice(0, 4) && recordMonth <= month;
  });
}

function currentYearRecords(records: SalesRecord[], month: string | null) {
  if (!month) return [];
  return records.filter((record) => {
    const recordMonth = monthKey(record.transaction_date);
    return recordMonth?.slice(0, 4) === month.slice(0, 4) && recordMonth <= month;
  });
}

function recordsForDateRange(records: SalesRecord[], startDate: string, endDate: string) {
  return records.filter((record) => {
    const date = record.transaction_date;
    return Boolean(date && date >= startDate && date <= endDate);
  });
}

function periodComparisonEndDate(month: string | null, periodRecords: SalesRecord[] = []) {
  if (!month) return null;
  const range = recordDateRange(periodRecords.filter((record) => monthKey(record.transaction_date) === month));
  return range?.endDate ?? dateKey(endOfMonth(parseDate(`${month}-01`)));
}

function currentYtdRecordsForPeriod(records: SalesRecord[], month: string | null, periodRecords: SalesRecord[] = []) {
  const endDate = periodComparisonEndDate(month, periodRecords);
  if (!month || !endDate) return [];
  return recordsForDateRange(records, `${month.slice(0, 4)}-01-01`, endDate);
}

function priorYtdRecordsForPeriod(records: SalesRecord[], month: string | null, periodRecords: SalesRecord[] = []) {
  const endDate = periodComparisonEndDate(month, periodRecords);
  if (!month || !endDate) return [];
  const priorYear = Number(month.slice(0, 4)) - 1;
  const priorMonth = `${priorYear}${month.slice(4)}`;
  const priorEndDate = sameMonthDayInYear(endDate, priorYear);
  const rangedRecords = recordsForDateRange(records, `${priorYear}-01-01`, priorEndDate);
  const priorMonthRecords = recordsForPeriod(records, priorMonth, "monthly");
  const hasPriorMonthInRange = rangedRecords.some((record) => monthKey(record.transaction_date) === priorMonth);

  if (hasPriorMonthInRange || !priorMonthRecords.length) return rangedRecords;

  return [
    ...rangedRecords.filter((record) => monthKey(record.transaction_date) !== priorMonth),
    ...priorMonthRecords,
  ];
}

function trailingSixMonthRecords(records: SalesRecord[], endMonth: string | null) {
  if (!endMonth) return [];
  const startMonth = shiftMonth(endMonth, -5);
  return records.filter((record) => {
    const recordMonth = monthKey(record.transaction_date);
    return Boolean(recordMonth && recordMonth >= startMonth && recordMonth <= endMonth);
  });
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function metricSet(records: SalesRecord[]): MetricSet {
  return {
    sales: sum(records.map(amountValue)),
    units: sum(records.map((record) => record.units ?? 0)),
    transactions: records.length,
  };
}

function topArtRows(
  records: SalesRecord[],
  ytdRecords: SalesRecord[],
  images: ProductImage[],
  inventoryRecords: InventoryRecord[] = [],
  sort: TopArtSort = "units",
): TopArt[] {
  const ytdGroups = groupBy(ytdRecords, artKey);
  const imageLookup = imageLookupMaps(images);
  const latestInventory = latestStandaloneInventoryRecords(inventoryRecords);
  const inventoryGroups = groupBy(latestInventory, artKey);
  return groupedRows(records, artKey)
    .map(([key, group]) => {
      const first = group[0];
      const style = normalizedStyle(first);
      const artCode = displayArtCode(first);
      const color = colorName(first);
      const cyGroup = ytdGroups.get(key) ?? [];
      const exactStandaloneInventory = inventoryGroups.get(key);
      const inventoryResult = inventoryTotalForTopArt(group, exactStandaloneInventory);
      return {
        rank: 0,
        key,
        style,
        brand: brandName(first),
        styleName: clean(first.master_style) || "Unknown Style Name",
        color,
        artCode,
        parentSku: firstNonBlank(group.map((record) => record.parent_sku)),
        sku: firstNonBlank(group.map((record) => record.sku)),
        sales: sum(group.map(amountValue)),
        units: sum(group.map((record) => record.units ?? 0)),
        transactions: group.length,
        cySales: sum(cyGroup.map(amountValue)),
        cyUnits: sum(cyGroup.map((record) => record.units ?? 0)),
        inventoryUnits: inventoryResult.units,
        inventoryScope: inventoryResult.scope,
        imageUrl: findProductImageUrl(imageLookup, style, artCode, color),
        productUrl: findProductPageUrl(imageLookup, style, artCode, color),
      };
    })
    .sort(sort === "dollars" ? sortBySales : sortByUnits)
    .slice(0, 30)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function inventoryLabel(row: Pick<TopArt, "inventoryScope" | "inventoryUnits">) {
  if (row.inventoryUnits == null) return "";
  return `Current Inv: ${numberText(row.inventoryUnits)}`;
}

function imageLookupMaps(images: ProductImage[]) {
  const exact = new Map<string, string>();
  const productUrls = new Map<string, string>();

  images.forEach((image) => {
    const productUrl = cleanProductPageUrl(image.product_url);
    if (productUrl) {
      productUrls.set(imageKey(image.style_number, image.art_code, image.color), productUrl);
    }
    const url = image.resolved_url ?? image.image_url;
    if (!url) return;
    exact.set(imageKey(image.style_number, image.art_code, image.color), url);
  });

  return { exact, productUrls };
}

function cleanProductPageUrl(value: string | null | undefined) {
  const raw = clean(value);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const path = url.pathname.toLowerCase();
    if (url.hostname.includes("utvolshop.com")) {
      if (path === "/" || path.startsWith("/search") || path.includes("/site/product-images/")) return null;
    }
    if (url.hostname.includes("rebelrags.net")) {
      if (path === "/" || path.startsWith("/prodimages/") || path.includes("/browse/keyword/")) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function findProductPageUrl(
  lookup: ReturnType<typeof imageLookupMaps>,
  style: string,
  artCode: string,
  color: string,
) {
  return lookup.productUrls.get(imageKey(style, artCode, color))
    ?? legacyProductPageUrl(lookup, style, artCode, color)
    ?? knownProductPageUrl(style, artCode, color);
}

function findProductImageUrl(
  lookup: ReturnType<typeof imageLookupMaps>,
  style: string,
  artCode: string,
  color: string,
) {
  const knownUrl = knownProductImageUrl(style, artCode, color);
  if (knownUrl) return knownUrl;

  const exact = lookup.exact.get(imageKey(style, artCode, color));
  const legacy = !exact ? legacyProductImageUrl(lookup, style, artCode, color) : null;
  const imageUrl = exact ?? legacy;
  if (!imageUrl) return null;
  return cachedImageUrlAllowedForColor(imageUrl, color, style, artCode) ? imageUrl : null;
}

function legacyProductImageUrl(
  lookup: ReturnType<typeof imageLookupMaps>,
  style: string,
  artCode: string,
  color: string,
) {
  if (
    compactImagePart(artCode) === "APC03479022" &&
    compactImagePart(color) === "WHITE" &&
    ["CT1000", "CS1220", "CS2071", "CT1730"].includes(compactImagePart(style))
  ) {
    return lookup.exact.get(imageKey(style, "03456518", color)) ?? null;
  }

  return null;
}

function legacyProductPageUrl(
  lookup: ReturnType<typeof imageLookupMaps>,
  style: string,
  artCode: string,
  color: string,
) {
  if (
    compactImagePart(artCode) === "APC03479022" &&
    compactImagePart(color) === "WHITE" &&
    ["CT1000", "CS1220", "CS2071", "CT1730"].includes(compactImagePart(style))
  ) {
    return lookup.productUrls.get(imageKey(style, "03456518", color)) ?? null;
  }

  return null;
}

function productImageCandidates({
  bestDayItems,
  images,
  records,
  topArt,
  visibleInventoryTracker,
  weeklyScorecards,
}: {
  bestDayItems: Array<{ style: string; artCode: string; color: string }>;
  images: ProductImage[];
  records: SalesRecord[];
  topArt: TopArt[];
  visibleInventoryTracker: InventoryTrackerItem[];
  weeklyScorecards: WeeklyScorecardRow[];
}) {
  const imageLookup = imageLookupMaps(images);
  const byKey = new Map<string, ImageFetchCandidate>();

  function addCandidate(candidate: Omit<ImageFetchCandidate, "imageUrl"> & { imageUrl?: string | null }) {
    const style = clean(candidate.style);
    const artCode = clean(candidate.artCode);
    const color = clean(candidate.color);
    if (!style || !artCode || !color || style === "-" || artCode === "-") return;

    const key = imageKey(style, artCode, color);
    const imageUrl = candidate.imageUrl ?? findProductImageUrl(imageLookup, style, artCode, color);
    if (imageUrl) return;

    const prepared: ImageFetchCandidate = {
      style,
      artCode,
      color,
      styleName: clean(candidate.styleName),
      parentSku: clean(candidate.parentSku) || null,
      sku: clean(candidate.sku) || null,
      imageUrl: null,
    };
    const existing = byKey.get(key);
    if (!existing || (!existing.parentSku && prepared.parentSku) || (!existing.sku && prepared.sku)) {
      byKey.set(key, existing ? { ...existing, ...prepared } : prepared);
    }
  }

  topArt.forEach((row) => addCandidate(row));
  visibleInventoryTracker.forEach((row) => addCandidate(row));
  weeklyScorecards.forEach((row) => row.topItems.forEach((item) => addCandidate({
    ...item,
    parentSku: null,
    sku: null,
    styleName: "",
  })));
  bestDayItems.forEach((item) => addCandidate({
    ...item,
    parentSku: null,
    sku: null,
    styleName: "",
  }));

  groupedRows(records, artKey)
    .map(([_key, group]) => {
      const first = group[0];
      return {
        style: normalizedStyle(first),
        artCode: displayArtCode(first),
        color: colorName(first),
        styleName: clean(first.master_style),
        parentSku: firstNonBlank(group.map((record) => record.parent_sku)),
        sku: firstNonBlank(group.map((record) => record.sku)),
        sales: sum(group.map(amountValue)),
        units: sum(group.map((record) => record.units ?? 0)),
      };
    })
    .sort((left, right) => right.units - left.units || right.sales - left.sales || left.style.localeCompare(right.style))
    .slice(0, IMAGE_PREFETCH_RECORD_GROUP_LIMIT)
    .forEach((row) => addCandidate(row));

  return [...byKey.values()];
}

function imageAttemptKey(row: Pick<ImageFetchCandidate, "style" | "artCode" | "color" | "parentSku" | "sku">) {
  return [imageKey(row.style, row.artCode, row.color), compactImagePart(row.parentSku ?? ""), compactImagePart(row.sku ?? "")]
    .filter(Boolean)
    .join("|");
}

function mergeProductImages(images: ProductImage[], matches: RebelRagsImageMatch[]) {
  const byKey = new Map(images.map((image) => [imageKey(image.style_number, image.art_code, image.color), image]));

  matches.forEach((match) => {
    byKey.set(imageKey(match.style, match.artCode, match.color), {
      style_number: match.style,
      art_code: match.artCode,
      color: match.color,
      image_url: match.sourceImageUrl ?? match.imageUrl,
      product_url: match.productUrl,
      storage_path: match.storagePath ?? null,
      resolved_url: match.imageUrl,
    });
  });

  return [...byKey.values()];
}

function isRebelRagsCustomer(name: string | null | undefined) {
  return (name ?? "").toLowerCase().includes("rebel");
}

function supportsProductImageFetch(name: string | null | undefined) {
  const normalizedName = (name ?? "").toLowerCase();
  return normalizedName.includes("rebel") || normalizedName.includes("volshop") || normalizedName.includes("vol shop");
}

function cachedImageUrlAllowedForColor(value: string, color: string, style: string, artCode: string) {
  if (isVolshopProductImageUrl(value)) return true;

  const isAllowedDefault = compactImagePart(color) === "WHITE"
    || compactImagePart(style) === "CBRZU0Z"
    || isGearStyle(style)
    || Boolean(knownProductImageUrl(style, artCode, color));
  return imageUrlMatchesColor(value, color) || (isAllowedDefault && imageColorToken(value) === "DEFAULT");
}

function isVolshopProductImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "www.utvolshop.com" && url.pathname.includes("/site/product-images/");
  } catch {
    return false;
  }
}

function knownProductImageUrl(style: string, artCode: string, color: string) {
  const normalizedStyle = compactImagePart(style);
  const normalizedArt = compactImagePart(artCode);
  const normalizedColor = compactImagePart(color);

  return knownVolshopImages[imageKey(normalizedStyle, normalizedArt, normalizedColor)]
    ?? knownRebelRagsImages[imageKey(normalizedStyle, normalizedArt, normalizedColor)]
    ?? null;
}

function knownProductPageUrl(style: string, artCode: string, color: string) {
  const normalizedStyle = compactImagePart(style);
  const normalizedArt = compactImagePart(artCode);
  const normalizedColor = compactImagePart(color);

  return knownRebelRagsProductPages[imageKey(normalizedStyle, normalizedArt, normalizedColor)]
    ?? null;
}

const knownVolshopImages: Record<string, string> = {
  [imageKey("CS3050", "AEC03612724", "GREY")]: "https://www.utvolshop.com/site/product-images/368238p_02.jpg?resizeid=3&resizeh=1200&resizew=1200",
};

const knownRebelRagsImages: Record<string, string> = {
  [imageKey("CT1000", "03456518", "NAVY")]: "https://www.rebelrags.net/prodimages/16228-MIDNIGHT_NAVY-l.jpg",
  [imageKey("CT1000", "03503350", "LIGHTBLUE")]: "https://www.rebelrags.net/prodimages/23149-DEFAULT-l.jpg",
  [imageKey("CT1000", "03687236", "WHITE")]: "https://www.rebelrags.net/prodimages/25026-WHITE-l.jpg",
  [imageKey("CT1000", "03751915", "WHITE")]: "https://www.rebelrags.net/prodimages/26212-DEFAULT-l.jpg",
  [imageKey("CT1000", "03751916", "WHITE")]: "https://www.rebelrags.net/prodimages/26213-DEFAULT-l.jpg",
  [imageKey("GDH100", "003862801", "PORCHBLUE")]: "https://www.rebelrags.net/prodimages/27361-PORCH_BLUE-l.jpg",
  [imageKey("GDH100", "003862801", "COTTONCANDY")]: "https://www.rebelrags.net/prodimages/27361-COTTON_CANDY-l.jpg",
  [imageKey("GDH100", "004116676", "COTTONCANDY")]: "https://www.rebelrags.net/prodimages/30756-COTTON_CANDY-l.jpg",
};

const knownRebelRagsProductPages: Record<string, string> = {
  [imageKey("G1092", "004116734", "OXFORDHEATHER")]: "https://www.rebelrags.net/gear/arch-block-ole-miss-big-cotton-tumbled-crewneck-31395",
};

function imageUrlMatchesColor(value: string, color: string) {
  const filename = compactImagePart(imageFilename(value));
  return colorSearchTerms(color).some((term) => filename.includes(term));
}

function colorSearchTerms(color: string) {
  const normalizedColor = compactImagePart(color);
  const terms = [normalizedColor];
  if (normalizedColor === "LIGHTBLUE") terms.push("LTBLUE");
  if (normalizedColor === "GRAYCAROLINABLUE") terms.push("LIGHTBLUE", "LTBLUE", "CAROLINABLUE");
  if (normalizedColor === "GREY") terms.push("GRAY");
  if (normalizedColor === "GRAY") terms.push("GREY");
  if (normalizedColor === "HEATHERGREY") terms.push("HEATHERGRAY");
  if (normalizedColor === "HEATHERGRAY") terms.push("HEATHERGREY");
  if (normalizedColor === "OXFORDGREY") terms.push("OXFORDGRAY");
  if (normalizedColor === "OXFORDGRAY") terms.push("OXFORDGREY");
  if (normalizedColor === "SILVERGREY") terms.push("SILVERGRAY");
  if (normalizedColor === "SILVERGRAY") terms.push("SILVERGREY");
  if (normalizedColor === "NAVY") terms.push("MIDNIGHTNAVY");
  if (normalizedColor === "MIDNIGHTNAVY") terms.push("NAVY");
  if (normalizedColor === "SCARLET") terms.push("RED");
  if (normalizedColor === "RED") terms.push("SCARLET");
  return terms;
}

function imageColorToken(value: string) {
  const parts = imageFilename(value).split("-");
  if (parts.length < 2) return "";
  return compactImagePart(parts[parts.length - 2]);
}

function imageFilename(value: string) {
  const decoded = value.replace(/&amp;/g, "&");
  try {
    const url = new URL(decoded, "https://www.rebelrags.net");
    return (url.pathname.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "");
  } catch {
    return decoded.split("?")[0].split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "";
  }
}

function topStyleRows(records: SalesRecord[], priorRecords: SalesRecord[]) {
  const currentRows = allStyleRows(records);
  const priorRows = allStyleRows(priorRecords);
  const currentByStyle = new Map(currentRows.map((row) => [row.style, row]));
  const priorByStyle = new Map(priorRows.map((row) => [row.style, row]));
  const styleKeys = new Set([...currentByStyle.keys(), ...priorByStyle.keys()]);

  return [...styleKeys]
    .map((style) => {
      const current = currentByStyle.get(style);
      const prior = priorByStyle.get(style);
      return {
        rank: 0,
        style,
        brand: current?.brand ?? prior?.brand ?? "",
        sales: current?.sales ?? 0,
        units: current?.units ?? 0,
        transactions: current?.transactions ?? 0,
        colorCount: current?.colorCount ?? 0,
        artCount: current?.artCount ?? 0,
        priorUnits: prior?.units ?? 0,
        priorSales: prior?.sales ?? 0,
        priorColorCount: prior?.colorCount ?? 0,
        priorArtCount: prior?.artCount ?? 0,
      };
    })
    .sort(
      (left, right) =>
        Math.max(right.units, right.priorUnits) - Math.max(left.units, left.priorUnits) ||
        Math.max(right.sales, right.priorSales) - Math.max(left.sales, left.priorSales),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function allStyleRows(records: SalesRecord[]): TopStyle[] {
  return groupedRows(records, styleKey)
    .map(([style, group]) => ({
      rank: 0,
      style,
      brand: brandName(group[0]),
      sales: sum(group.map(amountValue)),
      units: sum(group.map((record) => record.units ?? 0)),
      transactions: group.length,
      colorCount: uniqueCount(group.map(colorName)),
      artCount: uniqueCount(group.map((record) => clean(record.art_code))),
      priorUnits: 0,
      priorSales: 0,
      priorColorCount: 0,
      priorArtCount: 0,
    }))
    .sort((left, right) => right.units - left.units || right.sales - left.sales)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function salesMixSlices(records: SalesRecord[]) {
  const totals = new Map<string, number>();
  records.forEach((record) => {
    const audience = audienceName(record);
    totals.set(audience, (totals.get(audience) ?? 0) + (record.units ?? 0));
  });
  const totalUnits = sum([...totals.values()]);
  return ["Unisex", "Women's", "Youth"]
    .map((name) => {
      const units = totals.get(name) ?? 0;
      return { name, units, percent: totalUnits ? (units / totalUnits) * 100 : 0 };
    })
    .filter((slice) => slice.units > 0);
}

function bestSalesDay(records: SalesRecord[], images: ProductImage[] = []) {
  const imageLookup = imageLookupMaps(images);
  const sortedDays = groupedRows(records, (record) => record.transaction_date).sort((left, right) => {
      const salesDelta = sum(right[1].map(amountValue)) - sum(left[1].map(amountValue));
      return salesDelta || sum(right[1].map((record) => record.units ?? 0)) - sum(left[1].map((record) => record.units ?? 0));
    });
  const best = sortedDays[0];
  const date = best?.[0] ?? null;
  const dayRecords = best?.[1] ?? [];

  const topItems = groupedRows(dayRecords, artKey)
    .map(([_key, group]) => {
      const first = group[0];
      const style = normalizedStyle(first);
      const color = colorName(first);
      const artCode = displayArtCode(first);
      return {
        rank: 0,
        style,
        color,
        artCode,
        sales: sum(group.map(amountValue)),
        units: sum(group.map((record) => record.units ?? 0)),
        transactions: group.length,
        imageUrl: findProductImageUrl(imageLookup, style, artCode, color),
      };
    })
    .sort(sortBySales)
    .slice(0, 5)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    date,
    sales: sum(dayRecords.map(amountValue)),
    units: sum(dayRecords.map((record) => record.units ?? 0)),
    transactions: dayRecords.length,
    items: topItems,
    dayCount: sortedDays.length,
  };
}

function ytdPoints(records: SalesRecord[], month: string | null, periodRecords: SalesRecord[] = []) {
  if (!month) return { current: [], prior: [], currentTotal: 0, priorTotal: 0 };
  const year = Number(month.slice(0, 4));
  const lastMonth = Number(month.slice(5, 7));
  const current = Array.from({ length: 12 }, () => 0);
  const prior = Array.from({ length: 12 }, () => 0);
  const currentYtdRecords = periodRecords.length ? currentYtdRecordsForPeriod(records, month, periodRecords) : currentYearRecords(records, month);
  const priorYtdRecords = periodRecords.length ? priorYtdRecordsForPeriod(records, month, periodRecords) : currentYearRecords(records, `${year - 1}${month.slice(4)}`);
  const priorComparison = periodRecords.length ? priorPeriodComparison(records, { kind: "month", value: month, year }, periodRecords) : null;
  const priorComparisonRange = priorComparison?.usesFullMonth ? null : priorComparison?.range ?? null;

  records.forEach((record) => {
    const recordMonth = monthKey(record.transaction_date);
    if (!recordMonth) return;
    const recordYear = Number(recordMonth.slice(0, 4));
    const monthIndex = Number(recordMonth.slice(5, 7)) - 1;
    if (monthIndex < 0 || monthIndex > 11) return;
    const amount = amountValue(record);

    if (recordYear === year && monthIndex < lastMonth) {
      current[monthIndex] += amount;
    } else if (recordYear === year - 1) {
      if (priorComparisonRange && monthIndex === lastMonth - 1) {
        const date = record.transaction_date;
        if (!date || date < priorComparisonRange.startDate || date > priorComparisonRange.endDate) return;
      }
      prior[monthIndex] += amount;
    }
  });

  return {
    current,
    prior,
    currentTotal: sum(currentYtdRecords.map(amountValue)),
    priorTotal: sum(priorYtdRecords.map(amountValue)),
  };
}

function ytdInsightMetrics(currentRecords: SalesRecord[], priorRecords: SalesRecord[], month: string | null) {
  const monthCount = month ? Number(month.slice(5, 7)) : 0;
  const currentSales = sum(currentRecords.map(amountValue));
  const priorSales = sum(priorRecords.map(amountValue));
  const currentBreadth = breadthMetrics(currentRecords);
  const priorBreadth = breadthMetrics(priorRecords);

  return {
    averageMonthlySales: monthCount ? currentSales / monthCount : 0,
    priorAverageMonthlySales: monthCount ? priorSales / monthCount : 0,
    stylesSold: currentBreadth.styles,
    priorStylesSold: priorBreadth.styles,
    colorsSold: currentBreadth.colors,
    priorColorsSold: priorBreadth.colors,
    artworksSold: currentBreadth.artworks,
    priorArtworksSold: priorBreadth.artworks,
  };
}

function salesForecastMetrics(records: SalesRecord[], month: string | null) {
  if (!month) return null;
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  if (!year || !monthNumber) return null;

  const priorYearMonth = `${year - 1}${month.slice(4)}`;
  const currentYtdRecords = currentYearRecords(records, month);
  const priorYtdRecords = currentYearRecords(records, priorYearMonth);
  const priorFullYearRecords = recordsForYear(records, year - 1);

  const currentYtd = metricSet(currentYtdRecords);
  const priorYtd = metricSet(priorYtdRecords);
  const priorFullYear = metricSet(priorFullYearRecords);
  if (!currentYtd.sales && !currentYtd.units) return null;

  const priorFullYearMonths = uniqueCount(
    priorFullYearRecords
      .map((record) => monthKey(record.transaction_date) ?? "")
      .filter(Boolean),
  );
  const salesSeasonality = priorYtd.sales > 0 && priorFullYear.sales > 0
    ? priorYtd.sales / priorFullYear.sales
    : null;
  const unitsSeasonality = priorYtd.units > 0 && priorFullYear.units > 0
    ? priorYtd.units / priorFullYear.units
    : null;
  const monthlySalesPace = monthNumber ? currentYtd.sales / monthNumber : currentYtd.sales;
  const monthlyUnitPace = monthNumber ? currentYtd.units / monthNumber : currentYtd.units;
  const projectedSales = salesSeasonality
    ? currentYtd.sales / salesSeasonality
    : monthlySalesPace * 12;
  const projectedUnits = unitsSeasonality
    ? currentYtd.units / unitsSeasonality
    : monthlyUnitPace * 12;
  const confidence: SnapshotSalesForecast["confidence"] = priorFullYearMonths >= 9 && monthNumber >= 3
    ? "Stable"
    : priorFullYearMonths >= 3 && monthNumber >= 2
      ? "Directional"
      : "Limited";
  const note = salesSeasonality
    ? `Uses ${year - 1} seasonality through ${monthText(month)} to estimate the full-year finish.`
    : "Uses current monthly pace because prior-year seasonality is limited for this account and period.";

  return {
    currentYear: year,
    priorYear: year - 1,
    throughMonth: month,
    currentYtdSales: currentYtd.sales,
    priorYtdSales: priorYtd.sales,
    priorFullYearSales: priorFullYear.sales,
    projectedSales,
    remainingSales: projectedSales - currentYtd.sales,
    currentYtdUnits: currentYtd.units,
    priorYtdUnits: priorYtd.units,
    priorFullYearUnits: priorFullYear.units,
    projectedUnits,
    remainingUnits: projectedUnits - currentYtd.units,
    seasonalityPercent: salesSeasonality ? salesSeasonality * 100 : null,
    confidence,
    note,
  };
}

function monthlyDriverMetrics(currentRecords: SalesRecord[], priorRecords: SalesRecord[]) {
  const current = metricSet(currentRecords);
  const prior = metricSet(priorRecords);
  const currentBreadth = breadthMetrics(currentRecords);
  const priorBreadth = breadthMetrics(priorRecords);
  const topFiveStyleSales = sum([...allStyleRows(currentRecords)].sort((left, right) => right.sales - left.sales).slice(0, 5).map((row) => row.sales));

  return {
    avgSalePerTransaction: current.transactions ? current.sales / current.transactions : 0,
    priorAvgSalePerTransaction: prior.transactions ? prior.sales / prior.transactions : 0,
    avgUnitsPerTransaction: current.transactions ? current.units / current.transactions : 0,
    priorAvgUnitsPerTransaction: prior.transactions ? prior.units / prior.transactions : 0,
    avgSalePerUnit: current.units ? current.sales / current.units : 0,
    priorAvgSalePerUnit: prior.units ? prior.sales / prior.units : 0,
    stylesSold: currentBreadth.styles,
    priorStylesSold: priorBreadth.styles,
    colorsSold: currentBreadth.colors,
    priorColorsSold: priorBreadth.colors,
    artworksSold: currentBreadth.artworks,
    priorArtworksSold: priorBreadth.artworks,
    topFiveStyleSales,
    topFiveStyleShare: current.sales ? (topFiveStyleSales / current.sales) * 100 : 0,
  };
}

function weeklyScorecardRows(records: SalesRecord[], month: string | null, images: ProductImage[], uploads: UploadRecord[] = []): WeeklyScorecardRow[] {
  if (!month) return [];
  const uploadRows = uploadPeriodScorecardRows(records, month, images, uploads);
  if (uploadRows.length) return uploadRows;

  const imageLookup = imageLookupMaps(images);
  const monthStartDate = parseDate(`${month}-01`);
  const monthEndDate = endOfMonth(monthStartDate);
  const firstWeekStart = startOfMondayWeek(monthStartDate);
  const rows: WeeklyScorecardRow[] = [];

  for (let weekStart = firstWeekStart; weekStart <= monthEndDate; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    const segmentStart = maxDate(weekStart, monthStartDate);
    const segmentEnd = minDate(weekEnd, monthEndDate);
    const priorStart = addDays(segmentStart, -364);
    const priorEnd = addDays(segmentEnd, -364);
    const currentRecords = recordsBetween(records, dateKey(segmentStart), dateKey(segmentEnd));
    const priorRecords = recordsBetween(records, dateKey(priorStart), dateKey(priorEnd));
    const topItems = topWeeklyArtItems(currentRecords, imageLookup);

    rows.push({
      rank: rows.length + 1,
      title: `Week ${rows.length + 1}`,
      dateRange: dateRangeText(segmentStart, segmentEnd),
      dayCount: daysBetween(segmentStart, segmentEnd) + 1,
      current: metricSet(currentRecords),
      prior: metricSet(priorRecords),
      avgSalePerTransaction: currentRecords.length ? sum(currentRecords.map(amountValue)) / currentRecords.length : 0,
      breadth: breadthMetrics(currentRecords),
      priorBreadth: breadthMetrics(priorRecords),
      topItem: topItems[0] ?? null,
      topItems,
    });
  }

  return rows;
}

function uploadPeriodScorecardRows(records: SalesRecord[], month: string, images: ProductImage[], uploads: UploadRecord[]) {
  const uploadById = new Map(uploads.map((upload) => [upload.id, upload]));
  const imageLookup = imageLookupMaps(images);
  const monthStartDate = parseDate(`${month}-01`);
  const monthEndDate = endOfMonth(monthStartDate);
  const firstWeekStart = startOfMondayWeek(monthStartDate);
  const rows: WeeklyScorecardRow[] = [];

  const groups = groupedRows(
    records.filter((record) => monthKey(record.transaction_date) === month && record.upload_id),
    (record) => record.upload_id ?? "",
  )
    .map(([uploadId, group]) => ({ upload: uploadById.get(uploadId), group }))
    .filter((row): row is { upload: UploadRecord; group: SalesRecord[] } => Boolean(row.upload))
    .filter(({ upload, group }) => isSummaryUploadGroup(upload, group))
    .sort((left, right) => {
      const leftDate = left.upload.sales_period_start ?? latestRecordDate(left.group) ?? "";
      const rightDate = right.upload.sales_period_start ?? latestRecordDate(right.group) ?? "";
      return leftDate.localeCompare(rightDate) || left.upload.created_at.localeCompare(right.upload.created_at);
    });

  if (!groups.length) return [];

  const uploadSegments = groups.map(({ upload, group }) => {
    const fallbackDate = latestRecordDate(group) ?? `${month}-01`;
    const uploadStart = parseDate(upload.sales_period_start ?? fallbackDate);
    const uploadEnd = parseDate(upload.sales_period_end ?? upload.sales_period_start ?? fallbackDate);
    return {
      group,
      segmentStart: maxDate(uploadStart, monthStartDate),
      segmentEnd: minDate(uploadEnd, monthEndDate),
    };
  });

  for (let weekStart = firstWeekStart; weekStart <= monthEndDate; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    const segmentStart = maxDate(weekStart, monthStartDate);
    const segmentEnd = minDate(weekEnd, monthEndDate);
    const priorStart = addDays(segmentStart, -364);
    const priorEnd = addDays(segmentEnd, -364);
    const priorRecords = recordsBetween(records, dateKey(priorStart), dateKey(priorEnd));
    const currentRecords = uploadSegments
      .filter((segment) => segment.segmentEnd >= segmentStart && segment.segmentEnd <= segmentEnd)
      .flatMap((segment) => segment.group);
    const topItems = topWeeklyArtItems(currentRecords, imageLookup);

    rows.push({
      rank: rows.length + 1,
      title: `Week ${rows.length + 1}`,
      dateRange: dateRangeText(segmentStart, segmentEnd),
      dayCount: daysBetween(segmentStart, segmentEnd) + 1,
      current: metricSet(currentRecords),
      prior: metricSet(priorRecords),
      avgSalePerTransaction: currentRecords.length ? sum(currentRecords.map(amountValue)) / currentRecords.length : 0,
      breadth: breadthMetrics(currentRecords),
      priorBreadth: breadthMetrics(priorRecords),
      topItem: topItems[0] ?? null,
      topItems,
    });
  }

  return rows;
}

function isSummaryUploadGroup(upload: UploadRecord, group: SalesRecord[]) {
  const uploadStart = clean(upload.sales_period_start);
  const uploadEnd = clean(upload.sales_period_end);
  if (!uploadStart || !uploadEnd || uploadStart === uploadEnd) return false;

  const recordDates = new Set(group.map((record) => record.transaction_date).filter(Boolean));
  if (recordDates.size !== 1) return false;

  return daysBetween(parseDate(uploadStart), parseDate(uploadEnd)) >= 1;
}

function latestRecordDate(records: SalesRecord[]) {
  return records.map((record) => record.transaction_date).filter(Boolean).sort().at(-1) ?? null;
}

function topWeeklyArtItems(records: SalesRecord[], imageLookup: ReturnType<typeof imageLookupMaps>) {
  return groupedRows(records, artKey)
    .map<WeeklyTopItem>(([_key, group]) => {
      const first = group[0];
      const style = normalizedStyle(first);
      const color = colorName(first);
      const artCode = displayArtCode(first);
      return {
        style,
        color,
        artCode,
        sales: sum(group.map(amountValue)),
        units: sum(group.map((record) => record.units ?? 0)),
        imageUrl: findProductImageUrl(imageLookup, style, artCode, color),
      };
    })
    .sort(sortWeeklyTopItems)
    .slice(0, 3);
}

function recordsBetween(records: SalesRecord[], startDate: string, endDate: string) {
  return records.filter((record) => record.transaction_date >= startDate && record.transaction_date <= endDate);
}

function breadthMetrics(records: SalesRecord[]): BreadthMetrics {
  const soldRecords = records.filter((record) => (record.units ?? 0) !== 0 || amountValue(record) !== 0);
  return {
    styles: uniqueCount(soldRecords.map(normalizedStyle)),
    colors: uniqueCount(soldRecords.map(colorName)),
    artworks: uniqueCount(soldRecords.map((record) => clean(record.art_code))),
  };
}

function groupedRows<T>(items: T[], keyForItem: (item: T) => string): [string, T[]][] {
  return [...groupBy(items, keyForItem).entries()];
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string) {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = keyForItem(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return groups;
}

function brandName(record: MerchandiseRecord) {
  const style = normalizedStyle(record);
  if (style.startsWith("CBR")) return "Champion";
  const classText = `${record.product_class ?? ""} ${record.master_style ?? ""}`.toUpperCase();
  if (classText.includes("GEAR") || classText.includes("COMFORT WASH")) return "Gear";
  if (isGearStyle(style)) return "Gear";
  return "Champion";
}

function isGearStyle(style: string) {
  const normalized = compactImagePart(style);
  return GEAR_STYLE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function audienceName(record: MerchandiseRecord) {
  const text = `${record.product_class ?? ""} ${record.master_style ?? ""}`.toUpperCase();
  if (text.includes("YOUTH") || text.includes("INFANT") || text.includes("TODDLER")) return "Youth";
  if (text.includes("WOMEN") || text.includes("WMNS") || text.includes("W-S") || text.includes("LADY") || text.includes("LADIES")) {
    return "Women's";
  }
  return "Unisex";
}

function inventoryAudienceName(record: MerchandiseRecord): InventoryAudience {
  const text = `${record.product_class ?? ""} ${record.master_style ?? ""} ${record.style_number ?? ""}`.toUpperCase();
  const style = normalizedStyle(record);
  if (text.includes("YOUTH") || text.includes("INFANT") || text.includes("TODDLER") || style === "CT1081") return "Youth";
  if (text.includes("WOMEN") || text.includes("WMNS") || text.includes("W-S") || text.includes("LADY") || text.includes("LADIES")) return "Womens";
  if (text.includes("MENS") || text.includes("MEN ") || text.startsWith("M-") || style === "CT1000") return "Mens";
  return "Unisex";
}

function inventoryProductCategory(style: string): InventoryProductCategory {
  if (inventoryStyleMatches(style, INVENTORY_FLEECE_STYLES, INVENTORY_FLEECE_STYLE_PREFIXES)) return "Fleece";
  if (INVENTORY_REVERSE_WEAVE_STYLES.has(style)) return "Reverse Weave";
  if (inventoryStyleMatches(style, INVENTORY_TEE_STYLES, INVENTORY_TEE_STYLE_PREFIXES)) return "Tees";
  return "Other";
}

function inventoryStyleMatches(style: string, exactStyles: Set<string>, prefixes: string[]) {
  const normalized = style.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return exactStyles.has(normalized) || prefixes.some((prefix) => normalized.startsWith(prefix));
}

function inventoryAudienceMatches(row: InventoryTrackerItem, filter: InventoryAudienceFilter) {
  return filter === "All" || row.audience === filter;
}

function inventoryProductMatches(row: InventoryTrackerItem, filters: InventoryProductFilter[]) {
  return filters.length === 0 || filters.some((filter) => {
    if (filter === "Namedrop") return inventoryNamedropMatches(row);
    return row.productCategory === filter;
  });
}

function inventoryNamedropMatches(row: InventoryTrackerItem) {
  return row.style === "CT1000" && REBEL_RAGS_NAMEDROP_CT1000_ARTS.has(normalizedNamedropArtCode(row.artCode));
}

function normalizedNamedropArtCode(value: string) {
  const withoutPrefix = compactImagePart(value).replace(/^(APC|AEC|APO)/, "");
  return /^\d+$/.test(withoutPrefix) ? withoutPrefix.padStart(8, "0") : withoutPrefix;
}

function inventoryAudienceFilterLabel(filter: InventoryAudienceFilter) {
  if (filter === "Womens") return "Women's";
  return filter;
}

function inventoryFilterSummary(audienceFilter: InventoryAudienceFilter, productFilters: InventoryProductFilter[]) {
  const parts = [
    audienceFilter === "All" ? null : inventoryAudienceFilterLabel(audienceFilter),
    ...productFilters,
  ].filter((part): part is string => Boolean(part));
  if (!parts.length) return "All";
  if (parts.length === 1) return parts[0];
  return `${parts.length} selected`;
}

function normalizedStyle(record: MerchandiseRecord) {
  const sortedPrefixes = [...KNOWN_STYLE_PREFIXES].sort((left, right) => right.length - left.length);
  for (const rawValue of [record.style_number, record.raw_style_identifier]) {
    const upper = clean(rawValue)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
    const knownPrefix = sortedPrefixes.find((prefix) => upper.startsWith(prefix));
    if (knownPrefix) return knownPrefix;
  }

  const raw = clean(record.style_number) || clean(record.raw_style_identifier) || "-";
  const fallback = raw.toUpperCase().replace(/[^A-Z0-9]+$/g, "") || "-";
  return STYLE_NUMBER_ALIASES[fallback] ?? fallback;
}

function styleKey(record: MerchandiseRecord) {
  return normalizedStyle(record);
}

function artKey(record: MerchandiseRecord) {
  return [
    compactImagePart(brandName(record)),
    normalizedStyle(record),
    compactImagePart(displayArtCode(record)),
    colorIdentityKey(record),
  ].join("|");
}

function colorIdentityKey(record: MerchandiseRecord) {
  return colorCodeFromStyleIdentifier(record) || compactImagePart(record.color_code) || compactImagePart(colorName(record));
}

function colorCodeFromStyleIdentifier(record: MerchandiseRecord) {
  const style = normalizedStyle(record);
  if (!style || style === "-") return "";

  for (const value of [record.raw_style_identifier, record.style_number]) {
    const compact = compactImagePart(value);
    if (!compact.startsWith(style)) continue;

    const afterStyle = compact.slice(style.length);
    const artIndex = afterStyle.search(/(?:APC|APO|AEC|AE|AP)[A-Z0-9]+/);
    const beforeArt = artIndex >= 0 ? afterStyle.slice(0, artIndex) : afterStyle;
    const colorMatch = beforeArt.match(/^(\d{3,4})/);
    if (colorMatch) return colorMatch[1];
  }

  return "";
}

function displayArtCode(record: MerchandiseRecord) {
  const canonical = canonicalRebelRagsArtCode(record);
  if (canonical) return canonical;
  return clean(record.art_code) || normalizedStyle(record);
}

function canonicalRebelRagsArtCode(record: MerchandiseRecord) {
  const style = normalizedStyle(record);
  const artCode = compactImagePart(record.art_code);
  const color = compactImagePart(colorName(record));

  if (
    artCode === "03456518" &&
    color === "WHITE" &&
    ["CT1000", "CS1220", "CS2071", "CT1730"].includes(style)
  ) {
    return "APC03479022";
  }

  return null;
}

function imageKey(style: string, artCode: string, color: string) {
  return [compactImagePart(style), compactImagePart(artCode), compactImagePart(color)].join("|");
}

function compactImagePart(value: string | null | undefined) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function colorName(record: MerchandiseRecord) {
  return displayColorName(clean(record.catalog_color_name) || clean(record.color)) || "-";
}

const STYLE_NUMBER_ALIASES: Record<string, string> = {
  CS122: "CS1220",
  CS207: "CS2071",
};

function displayColorName(value: string) {
  const spaced = clean(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!spaced) return "";
  return spaced
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function monthKey(value: string | null) {
  return value?.slice(0, 7) ?? null;
}

function amountValue(record: SalesRecord) {
  return Number(record.amount ?? 0);
}

function inventorySnapshotForRecords(
  records: SalesRecord[],
  standaloneInventoryRecords: InventoryRecord[] = [],
  periodEndMonth: string | null = null,
  trendRecords: SalesRecord[] = records,
): InventorySnapshot {
  const snapshotRecords = latestInventoryRecords(records, standaloneInventoryRecords, periodEndMonth);
  if (!snapshotRecords.length) return null;
  const totalUnits = sum(snapshotRecords.map((record) => record.inventory_units ?? 0));
  const monthlySalesPace = normalizedMonthlyUnitPace(records);
  const line = inventoryLinePoints(trendRecords, standaloneInventoryRecords, periodEndMonth);
  const coverage = monthlySalesPace ? totalUnits / monthlySalesPace : null;
  const date = inventoryRecordDate(snapshotRecords[0]);
  return {
    date,
    totalUnits,
    styles: uniqueCount(snapshotRecords.map(styleKey)),
    artworks: uniqueCount(snapshotRecords.map((record) => clean(record.art_code))),
    coverage,
    line,
    position: inventoryPositionForSnapshot(totalUnits, coverage, line, date),
    byBrand: inventoryByBrand(snapshotRecords),
    topStyles: topInventoryStyles(snapshotRecords),
  };
}

function inventoryPositionForSnapshot(
  totalUnits: number,
  coverage: number | null,
  line: InventoryLine | null,
  date: string,
): InventoryPosition {
  const monthIndex = monthIndexFromDate(date);
  const targetCoverage = inventoryTargetCoverage(monthIndex);
  const coverageScore = coverage == null
    ? 50
    : clamp(50 + ((coverage - targetCoverage) / targetCoverage) * 42, 8, 92);
  const priorSameMonth = monthIndex == null ? null : line?.prior[monthIndex] ?? null;
  const priorShift = priorSameMonth && priorSameMonth > 0
    ? clamp(((totalUnits - priorSameMonth) / priorSameMonth) * 22, -12, 12)
    : 0;
  const score = Math.round(clamp(coverageScore + priorShift, 5, 95));
  const label: InventoryPosition["label"] = score < 40 ? "Lean" : score > 60 ? "Heavy" : "Balanced";
  const coverageText = coverage == null
    ? "Current stock cannot be matched cleanly to recent selling pace yet."
    : `Current stock covers about ${coverage.toFixed(1)} months at the normalized sales pace.`;
  const detail = `${coverageText} ${inventorySeasonText(monthIndex)}`;
  const comparison = priorSameMonth && priorSameMonth > 0
    ? sameMonthInventoryComparison(totalUnits, priorSameMonth, line?.priorYear)
    : "Prior-year same-month inventory is not available yet, so this read leans more on current sales pace.";

  return {
    score,
    label,
    headline: inventoryPositionHeadline(label),
    detail,
    comparison,
  };
}

function inventoryPositionHeadline(label: InventoryPosition["label"]) {
  if (label === "Lean") return "Inventory is leaning light for the demand window ahead.";
  if (label === "Heavy") return "Inventory is carrying heavier than the current selling pace.";
  return "Inventory looks balanced against current pace and seasonal demand.";
}

function inventorySeasonText(monthIndex: number | null) {
  if (monthIndex == null) return "Use this as a directional read until more dated inventory history is available.";
  if (monthIndex === 5 || monthIndex === 6) {
    return "Because August back-to-school and football traffic are close, a healthy position should sit above an ordinary month without getting overbuilt.";
  }
  if (monthIndex >= 7 && monthIndex <= 10) {
    return "This is the back-to-school and football demand window, so weekly sell-through can accelerate quickly.";
  }
  if (monthIndex === 11 || monthIndex === 0) {
    return "This is more of a reset window after the busiest season, so extra stock deserves closer review.";
  }
  return "This is a planning window before campus traffic ramps, so the score favors balanced depth over aggressive inventory.";
}

function inventoryTargetCoverage(monthIndex: number | null) {
  if (monthIndex == null) return 3.4;
  if (monthIndex === 5 || monthIndex === 6) return 4.2;
  if (monthIndex >= 7 && monthIndex <= 10) return 3.1;
  if (monthIndex === 11 || monthIndex === 0) return 2.5;
  return 3.3;
}

function sameMonthInventoryComparison(totalUnits: number, priorUnits: number, priorYear?: number) {
  const percent = ((totalUnits - priorUnits) / priorUnits) * 100;
  const direction = percent >= 0 ? "above" : "below";
  return `Inventory is ${Math.abs(percent).toFixed(1)}% ${direction} ${priorYear ?? "prior-year"} same-month on-hand levels.`;
}

function monthIndexFromDate(value: string) {
  const month = Number(value.slice(5, 7));
  return month ? month - 1 : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function inventoryLinePoints(
  salesRecords: SalesRecord[],
  standaloneInventoryRecords: InventoryRecord[] = [],
  periodEndMonth: string | null = null,
): InventoryLine | null {
  if (!periodEndMonth) return null;
  const currentYear = Number(periodEndMonth.slice(0, 4));
  const currentMonthIndex = Number(periodEndMonth.slice(5, 7)) - 1;
  if (!currentYear || currentMonthIndex < 0) return null;

  const useStandalone = standaloneInventoryRecords.some((record) => record.inventory_units != null);
  const sourceRecords: Array<SalesRecord | InventoryRecord> = useStandalone
    ? standaloneInventoryRecords
    : salesRecords.filter((record) => record.inventory_units != null);
  const current = monthlyInventoryPoints(sourceRecords, currentYear, currentMonthIndex);
  const prior = monthlyInventoryPoints(sourceRecords, currentYear - 1, 11);
  const hasPoints = [...current, ...prior].some((value) => value != null);

  if (!hasPoints) return null;
  return {
    current,
    prior,
    currentYear,
    priorYear: currentYear - 1,
  };
}

function monthlyInventoryPoints(
  records: Array<SalesRecord | InventoryRecord>,
  year: number,
  maxMonthIndex: number,
) {
  return Array.from({ length: 12 }, (_, monthIndex): number | null => {
    if (monthIndex > maxMonthIndex) return null;
    const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const monthRecords = records.filter((record) => inventoryRecordDate(record).slice(0, 7) === month && record.inventory_units != null);
    if (!monthRecords.length) return null;

    const latestByBrand = [...groupBy(monthRecords, brandName).values()].flatMap((brandRecords) => {
      const latestDate = brandRecords.map(inventoryRecordDate).sort().at(-1);
      return latestDate ? brandRecords.filter((record) => inventoryRecordDate(record) === latestDate) : [];
    });

    const totalUnits = sum(latestByBrand.map((record) => record.inventory_units ?? 0));
    return Number.isFinite(totalUnits) ? totalUnits : null;
  });
}

function pagedInventoryTrackerRows({
  contextRecords,
  images,
  inventoryAudienceFilter,
  inventoryPage,
  inventoryPageSize,
  inventoryProductFilters,
  periodEndMonth,
  periodRecords,
  priorYearRecords,
  sort,
  standaloneInventoryRecords,
  ytdCurrentRecords,
}: {
  contextRecords: SalesRecord[];
  images: ProductImage[];
  inventoryAudienceFilter: InventoryAudienceFilter;
  inventoryPage: number;
  inventoryPageSize: number;
  inventoryProductFilters: InventoryProductFilter[];
  periodEndMonth: string | null;
  periodRecords: SalesRecord[];
  priorYearRecords: SalesRecord[];
  sort: InventorySort;
  standaloneInventoryRecords: InventoryRecord[];
  ytdCurrentRecords: SalesRecord[];
}): { meta: InventoryTrackerMeta; rows: InventoryTrackerItem[] } {
  const pageSize = positiveInteger(inventoryPageSize, INVENTORY_TRACKER_PAGE_SIZE);
  const allRows = inventoryTrackerRows(
    periodRecords,
    ytdCurrentRecords,
    priorYearRecords,
    standaloneInventoryRecords,
    periodEndMonth,
    images,
    sort,
    contextRecords,
  );
  const filteredRows = allRows.filter((row) => (
    inventoryAudienceMatches(row, inventoryAudienceFilter) &&
    inventoryProductMatches(row, inventoryProductFilters)
  ));
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const page = Math.min(Math.max(positiveInteger(inventoryPage, 1), 1), pageCount);
  const pageStart = filteredRows.length ? (page - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(page * pageSize, filteredRows.length);
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  return {
    meta: {
      totalItems: filteredRows.length,
      totalUnits: sum(filteredRows.map((row) => row.inventoryUnits)),
      page,
      pageSize,
      pageCount,
      pageStart,
      pageEnd,
      sort,
      audienceFilter: inventoryAudienceFilter,
      productFilters: inventoryProductFilters,
    },
    rows,
  };
}

function inventoryTrackerRows(
  records: SalesRecord[],
  ytdRecords: SalesRecord[],
  priorYearRecords: SalesRecord[],
  standaloneInventoryRecords: InventoryRecord[] = [],
  periodEndMonth: string | null,
  images: ProductImage[],
  sort: InventorySort = "highest",
  contextRecords: SalesRecord[] = [],
) {
  const snapshotRecords = latestInventoryRecords(records, standaloneInventoryRecords, periodEndMonth);
  const ytdGroups = groupBy(ytdRecords, (record) => artKey(record));
  const priorYearGroups = groupBy(priorYearRecords, (record) => artKey(record));
  const recentRecords = trailingSixMonthRecords(contextRecords.length ? contextRecords : [...records, ...ytdRecords], periodEndMonth);
  const recentGroups = groupBy(recentRecords, (record) => artKey(record));
  const salesContextGroups = groupBy([...contextRecords, ...records, ...ytdRecords, ...priorYearRecords], (record) => artKey(record));
  const imageLookup = imageLookupMaps(images);

  return groupedRows(snapshotRecords, (record) => artKey(record))
    .map<InventoryTrackerItem>(([key, group]) => {
      const first = group[0];
      const salesContext = salesContextGroups.get(key) ?? [];
      const priorYearMatches = priorYearGroups.get(key);
      const style = normalizedStyle(first);
      const artCode = displayArtCode(first);
      const color = colorName(first);
      return {
        rank: 0,
        key,
        style,
        brand: brandName(first),
        styleName: clean(first.master_style) || firstNonBlank(salesContext.map((record) => record.master_style)) || "",
        color,
        artCode,
        parentSku: firstNonBlank([...group.map(recordParentSku), ...salesContext.map((record) => record.parent_sku)]),
        sku: firstNonBlank([...group.map(recordSku), ...salesContext.map((record) => record.sku)]),
        audience: inventoryAudienceName(first),
        productCategory: inventoryProductCategory(style),
        ytdUnits: sum((ytdGroups.get(key) ?? []).map((record) => record.units ?? 0)),
        priorYearUnits: priorYearMatches?.length ? sum(priorYearMatches.map((record) => record.units ?? 0)) : null,
        recentSixMonthUnits: sum((recentGroups.get(key) ?? []).map((record) => record.units ?? 0)),
        inventoryUnits: sum(group.map((record) => record.inventory_units ?? 0)),
        imageUrl: findProductImageUrl(imageLookup, style, artCode, color),
        productUrl: findProductPageUrl(imageLookup, style, artCode, color),
      };
    })
    .filter((row) => (
      row.inventoryUnits >= INVENTORY_TRACKER_MIN_UNITS ||
      row.recentSixMonthUnits > INVENTORY_TRACKER_RECENT_DEMAND_UNITS
    ))
    .sort((left, right) => {
      const unitDelta = sort === "highest"
        ? right.inventoryUnits - left.inventoryUnits
        : left.inventoryUnits - right.inventoryUnits;
      return unitDelta || left.style.localeCompare(right.style) || left.artCode.localeCompare(right.artCode);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function positiveInteger(value: number, fallback: number) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizedMonthlyUnitPace(records: SalesRecord[]) {
  if (!records.length) return null;

  const monthGroups = groupBy(records, (record) => monthKey(record.transaction_date) ?? "");
  const monthlyPaces = [...monthGroups.entries()]
    .filter(([month]) => month)
    .map(([month, monthRecords]) => {
      const units = sum(monthRecords.map((record) => record.units ?? 0));
      const transactionDays = [...new Set(monthRecords.map((record) => Number(record.transaction_date.slice(8, 10))).filter(Boolean))];
      const latestDay = Math.max(...transactionDays, 0);
      const daysInMonth = daysInCalendarMonth(month);

      if (transactionDays.length > 1 && latestDay > 0 && latestDay < daysInMonth) {
        return units / latestDay * daysInMonth;
      }

      return units;
    })
    .filter((pace) => Number.isFinite(pace) && pace > 0);

  if (!monthlyPaces.length) return null;
  return sum(monthlyPaces) / monthlyPaces.length;
}

function daysInCalendarMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return 30;
  return new Date(year, monthNumber, 0).getDate();
}

function inventoryTotalForTopArt(
  records: SalesRecord[],
  exactStandaloneRecords: InventoryRecord[] | undefined,
) {
  if (exactStandaloneRecords?.length) {
    return {
      units: sum(exactStandaloneRecords.map((record) => record.inventory_units ?? 0)),
      scope: "color" as const,
    };
  }

  const snapshotRecords = latestEmbeddedInventoryRecords(records);
  if (snapshotRecords.length) {
    return {
      units: sum(snapshotRecords.map((record) => record.inventory_units ?? 0)),
      scope: "color" as const,
    };
  }

  return { units: null, scope: null };
}

function latestInventoryRecords(
  records: SalesRecord[],
  standaloneInventoryRecords: InventoryRecord[],
  _periodEndMonth: string | null,
): Array<SalesRecord | InventoryRecord> {
  const standaloneSnapshot = latestStandaloneInventoryRecords(standaloneInventoryRecords);
  if (standaloneSnapshot.length) return standaloneSnapshot;
  return latestEmbeddedInventoryRecords(records);
}

function latestEmbeddedInventoryRecords(records: SalesRecord[]) {
  const inventoryRecords = records.filter((record) => record.inventory_units != null);
  const latestInventoryDate = inventoryRecords.map((record) => record.transaction_date).sort().at(-1);
  if (!latestInventoryDate) return [];
  return inventoryRecords.filter((record) => record.transaction_date === latestInventoryDate);
}

function latestStandaloneInventoryRecords(records: InventoryRecord[], periodEndMonth: string | null = null) {
  const maxDate = periodEndMonth ? `${periodEndMonth}-31` : null;
  const inventoryRecords = records.filter((record) => record.inventory_units != null && (!maxDate || record.inventory_date <= maxDate));
  const latestInventoryDate = inventoryRecords.map((record) => record.inventory_date).sort().at(-1);
  if (!latestInventoryDate) return [];
  return inventoryRecords.filter((record) => record.inventory_date === latestInventoryDate);
}

function inventoryErrorMessage(error: string | null | undefined) {
  if (!error) return "";
  if (error.includes("inventory_records") || error.includes("PGRST205") || error.includes("schema cache")) {
    return "Inventory reports are not active yet. Run the updated Supabase schema so SalesLens can save Rebel Rags inventory uploads.";
  }
  return "";
}

function inventoryRecordDate(record: SalesRecord | InventoryRecord) {
  return "inventory_date" in record ? record.inventory_date : record.transaction_date;
}

function recordParentSku(record: SalesRecord | InventoryRecord) {
  return "parent_sku" in record ? record.parent_sku : null;
}

function recordSku(record: SalesRecord | InventoryRecord) {
  return "sku" in record ? record.sku : null;
}

function inventoryByBrand(records: Array<SalesRecord | InventoryRecord>) {
  return groupedRows(records, brandName)
    .map(([brand, group]) => ({
      brand,
      units: sum(group.map((record) => record.inventory_units ?? 0)),
    }))
    .sort((left, right) => right.units - left.units || left.brand.localeCompare(right.brand));
}

function topInventoryStyles(records: Array<SalesRecord | InventoryRecord>) {
  return groupedRows(records, styleKey)
    .map(([style, group]) => ({
      style,
      brand: brandName(group[0]),
      units: sum(group.map((record) => record.inventory_units ?? 0)),
      artworks: uniqueCount(group.map((record) => clean(record.art_code))),
    }))
    .filter((row) => row.units > 0)
    .sort((left, right) => right.units - left.units || left.style.localeCompare(right.style))
    .slice(0, 10);
}

function latestDate(records: SalesRecord[]) {
  return records.map((record) => record.transaction_date).sort().at(-1) ?? null;
}
