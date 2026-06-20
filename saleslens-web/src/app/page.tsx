"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  parseInventoryWorkbook,
  parseSalesWorkbook,
  type ParsedInventoryRecord,
  type ParsedSalesRecord,
  type SalesImportOptions,
} from "@/lib/importSalesData";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { currencyText, dateText, monthText, numberText, wholeCurrencyText } from "@/lib/formatters";
import type { ReportSnapshotBundlePayload, ReportSnapshotPayload } from "@/lib/reportSnapshot";
import type { Customer } from "@/lib/types";

type SalesRecord = {
  id: string;
  customer_id: string;
  transaction_date: string;
  amount: number | string | null;
  units: number | null;
  transaction_number: string | null;
  barcode: string | null;
  parent_sku: string | null;
  sku: string | null;
  product_class: string | null;
  master_style: string | null;
  color: string | null;
  size: string | null;
  catalog_color_name: string | null;
  style_number: string | null;
  raw_style_identifier: string | null;
  color_code: string | null;
  art_code: string | null;
  inventory_units: number | null;
  year_to_date_amount: number | string | null;
  year_to_date_units: number | null;
};

type InventoryRecord = {
  id: string;
  customer_id: string;
  upload_id: string | null;
  inventory_date: string;
  source_file: string;
  product_class: string | null;
  master_style: string | null;
  color: string | null;
  size: string | null;
  raw_style_identifier: string | null;
  style_number: string | null;
  catalog_color_name: string | null;
  art_code: string | null;
  inventory_units: number | null;
  current_retail: number | string | null;
};

type MerchandiseRecord = {
  product_class: string | null;
  master_style: string | null;
  style_number: string | null;
  raw_style_identifier: string | null;
  catalog_color_name: string | null;
  color: string | null;
  color_code?: string | null;
  art_code: string | null;
};

type ProductImage = {
  style_number: string;
  art_code: string;
  color: string;
  product_url: string | null;
  image_url: string | null;
  storage_path: string | null;
  resolved_url?: string | null;
};

type RebelRagsImageMatch = {
  style: string;
  artCode: string;
  color: string;
  productUrl: string;
  imageUrl: string;
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

type DashboardData = {
  records: SalesRecord[];
  inventoryRecords: InventoryRecord[];
  images: ProductImage[];
};

type MetricSet = {
  sales: number;
  units: number;
  transactions: number;
};

type WeeklyTopItem = {
  style: string;
  color: string;
  artCode: string;
  sales: number;
  units: number;
  imageUrl: string | null;
};

type TopArt = MetricSet & {
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

type InventoryTrackerItem = {
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

type InventorySort = "highest" | "lowest";
type InventoryAudience = "Unisex" | "Womens" | "Mens" | "Youth";
type InventoryAudienceFilter = "All" | "Mens" | "Womens" | "Youth";
type InventoryProductCategory = "Fleece" | "Reverse Weave" | "Tees" | "Other";
type InventoryProductFilter = "All" | "Fleece" | "Reverse Weave" | "Tees";
type TopArtSort = "units" | "dollars";

type TopStyle = MetricSet & {
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

type BreadthMetrics = {
  styles: number;
  colors: number;
  artworks: number;
};

type WeeklyScorecardRow = {
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

type PeriodSelection =
  | { kind: "month"; value: string; year: number }
  | { kind: "year"; value: string; year: number };

type SalesMixSlice = {
  name: string;
  units: number;
  percent: number;
};

type InventoryLine = {
  current: Array<number | null>;
  prior: Array<number | null>;
  currentYear: number;
  priorYear: number;
};

type InventoryPosition = {
  score: number;
  label: "Lean" | "Balanced" | "Heavy";
  headline: string;
  detail: string;
  comparison: string;
};

type InventorySnapshot = {
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

const PAGE_SIZE = 1000;
const IMAGE_FETCH_BATCH_SIZE = 30;
const IMAGE_PREFETCH_LIMIT = 300;
const INVENTORY_TRACKER_MIN_UNITS = 5;
const INVENTORY_TRACKER_RECENT_DEMAND_UNITS = 25;
const INVENTORY_TRACKER_PAGE_SIZE = 50;
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

export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerStatus, setCustomerStatus] = useState("Loading accounts...");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState("All");
  const [styleStudyMode, setStyleStudyMode] = useState<"month" | "ytd">("month");
  const [inventorySort, setInventorySort] = useState<InventorySort>("highest");
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryAudienceFilter, setInventoryAudienceFilter] = useState<InventoryAudienceFilter>("All");
  const [inventoryProductFilter, setInventoryProductFilter] = useState<InventoryProductFilter>("All");
  const [topArtSort, setTopArtSort] = useState<TopArtSort>("units");
  const [dashboardData, setDashboardData] = useState<DashboardData>({ records: [], inventoryRecords: [], images: [] });
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [pendingImportFiles, setPendingImportFiles] = useState<File[]>([]);
  const [importRangeStart, setImportRangeStart] = useState("");
  const [importRangeEnd, setImportRangeEnd] = useState("");
  const [dashboardStatus, setDashboardStatus] = useState("");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [selectedShareCustomerIds, setSelectedShareCustomerIds] = useState<string[]>([]);
  const [shareStatus, setShareStatus] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [navCompact, setNavCompact] = useState(false);
  const [imagePrefetchRun, setImagePrefetchRun] = useState(0);
  const imageFetchAttempts = useRef<Set<string>>(new Set());

  useEffect(() => {
    imageFetchAttempts.current.clear();
    setImagePrefetchRun(0);
  }, [selectedCustomerId]);

  useEffect(() => {
    if (!supabase) {
      setStatus("SalesLens is missing Supabase environment variables.");
      return;
    }

    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    const updateNavSize = () => setNavCompact(window.scrollY > 24);
    updateNavSize();
    window.addEventListener("scroll", updateNavSize, { passive: true });
    return () => window.removeEventListener("scroll", updateNavSize);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setCustomerStatus("SalesLens is missing Supabase environment variables.");
      return;
    }

    if (!user) {
      setCustomers([]);
      return;
    }

    let isMounted = true;
    setCustomerStatus("Loading accounts...");
    supabase
      .from("customers")
      .select("id,name,display_order")
      .order("display_order", { ascending: true })
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setCustomerStatus(error.message);
          return;
        }
        setCustomers(data ?? []);
        setSelectedCustomerId((current) => current ?? data?.[0]?.id ?? null);
        setCustomerStatus("");
      });

    return () => {
      isMounted = false;
    };
  }, [supabase, user]);

  useEffect(() => {
    if (!supabase || !selectedCustomerId) {
      setDashboardData({ records: [], inventoryRecords: [], images: [] });
      return;
    }

    const client = supabase;
    const customerId = selectedCustomerId;
    let isMounted = true;
    setDashboardStatus("Loading sales records...");

    async function loadDashboard() {
      const [recordsResult, inventoryResult, imagesResult] = await Promise.all([
        fetchAllRecords(client, customerId),
        fetchInventoryRecords(client, customerId),
        fetchProductImages(client, customerId),
      ]);

      if (!isMounted) return;

      if (recordsResult.error) {
        setDashboardStatus(recordsResult.error);
        setDashboardData({ records: [], inventoryRecords: [], images: [] });
        return;
      }

      const records = recordsResult.records;
      setDashboardData({ records, inventoryRecords: inventoryResult.records, images: imagesResult.images });
      setSelectedPeriod((current) => current ?? defaultPeriodValue(records));
      setDashboardStatus(inventoryErrorMessage(inventoryResult.error));
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [supabase, selectedCustomerId, reloadKey]);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const months = useMemo(() => availableMonths(dashboardData.records), [dashboardData.records]);
  const years = useMemo(() => availableYears(dashboardData.records), [dashboardData.records]);
  const periodOptions = useMemo(() => periodOptionGroups(months, years), [months, years]);
  const selectedPeriodValue = selectedPeriod ?? defaultPeriodValue(dashboardData.records);
  const period = selectedPeriodValue ? parsePeriodValue(selectedPeriodValue) : null;

  const recordsForCustomer = useMemo(() => {
    return dashboardData.records.filter((record) => brandFilter === "All" || brandName(record) === brandFilter);
  }, [brandFilter, dashboardData.records]);
  const inventoryRecordsForCustomer = useMemo(() => {
    return dashboardData.inventoryRecords.filter((record) => brandFilter === "All" || brandName(record) === brandFilter);
  }, [brandFilter, dashboardData.inventoryRecords]);

  const periodEndMonth = useMemo(() => {
    if (!period) return null;
    if (period.kind === "month") return period.value;
    return latestMonthForYear(recordsForCustomer, period.year);
  }, [period, recordsForCustomer]);
  const selectedYear = period?.year ?? null;
  const priorYearMonth = periodEndMonth && selectedYear ? `${selectedYear - 1}${periodEndMonth.slice(4)}` : null;
  const selectedPeriodTitle = periodTitle(period, periodEndMonth);
  const priorPeriodTitle = priorTitle(period, periodEndMonth);
  const selectedPeriodKind = period?.kind ?? "month";

  const periodRecords = useMemo(() => {
    if (!period) return [];
    return recordsForSelectedPeriod(recordsForCustomer, period);
  }, [period, recordsForCustomer]);

  const priorPeriodRecords = useMemo(() => {
    if (!period) return [];
    return recordsForPriorPeriod(recordsForCustomer, period);
  }, [period, recordsForCustomer]);

  const comparisonRecords = priorPeriodRecords;

  const currentMetrics = useMemo(() => metricSet(periodRecords), [periodRecords]);
  const priorMetrics = useMemo(() => metricSet(priorPeriodRecords), [priorPeriodRecords]);
  const monthlyDrivers = useMemo(() => monthlyDriverMetrics(periodRecords, priorPeriodRecords), [periodRecords, priorPeriodRecords]);
  const weeklyScorecards = useMemo(
    () => weeklyScorecardRows(recordsForCustomer, periodEndMonth, dashboardData.images),
    [dashboardData.images, periodEndMonth, recordsForCustomer],
  );
  const totalRecordsMetrics = useMemo(() => metricSet(recordsForCustomer), [recordsForCustomer]);
  const ytdCurrentRecords = useMemo(
    () => currentYearRecords(recordsForCustomer, periodEndMonth),
    [recordsForCustomer, periodEndMonth],
  );
  const ytdPriorRecords = useMemo(
    () => (priorYearMonth ? currentYearRecords(recordsForCustomer, priorYearMonth) : []),
    [priorYearMonth, recordsForCustomer],
  );
  const priorYearRecords = useMemo(
    () => (selectedYear ? recordsForYear(recordsForCustomer, selectedYear - 1) : []),
    [recordsForCustomer, selectedYear],
  );
  const ytdInsights = useMemo(
    () => ytdInsightMetrics(ytdCurrentRecords, ytdPriorRecords, periodEndMonth),
    [periodEndMonth, ytdCurrentRecords, ytdPriorRecords],
  );
  const topArt = useMemo(
    () => topArtRows(periodRecords, ytdCurrentRecords, dashboardData.images, inventoryRecordsForCustomer, topArtSort),
    [dashboardData.images, inventoryRecordsForCustomer, periodRecords, topArtSort, ytdCurrentRecords],
  );
  const periodStyleStudy = useMemo(() => topStyleRows(periodRecords, comparisonRecords), [periodRecords, comparisonRecords]);
  const ytdStyleStudy = useMemo(() => topStyleRows(ytdCurrentRecords, ytdPriorRecords), [ytdCurrentRecords, ytdPriorRecords]);
  const salesMix = useMemo(() => salesMixSlices(periodRecords), [periodRecords]);
  const inventorySnapshot = useMemo(
    () => inventorySnapshotForRecords(periodRecords, inventoryRecordsForCustomer, periodEndMonth, recordsForCustomer),
    [inventoryRecordsForCustomer, periodEndMonth, periodRecords, recordsForCustomer],
  );
  const inventoryTracker = useMemo(
    () => inventoryTrackerRows(periodRecords, ytdCurrentRecords, priorYearRecords, inventoryRecordsForCustomer, periodEndMonth, dashboardData.images, inventorySort, recordsForCustomer),
    [dashboardData.images, inventoryRecordsForCustomer, inventorySort, periodEndMonth, periodRecords, priorYearRecords, recordsForCustomer, ytdCurrentRecords],
  );
  const filteredInventoryTracker = useMemo(
    () => inventoryTracker.filter((row) => (
      inventoryAudienceMatches(row, inventoryAudienceFilter) &&
      inventoryProductMatches(row, inventoryProductFilter)
    )),
    [inventoryAudienceFilter, inventoryProductFilter, inventoryTracker],
  );
  const inventoryPageCount = Math.max(1, Math.ceil(filteredInventoryTracker.length / INVENTORY_TRACKER_PAGE_SIZE));
  const currentInventoryPage = Math.min(inventoryPage, inventoryPageCount);
  const visibleInventoryTracker = useMemo(
    () => filteredInventoryTracker.slice(
      (currentInventoryPage - 1) * INVENTORY_TRACKER_PAGE_SIZE,
      currentInventoryPage * INVENTORY_TRACKER_PAGE_SIZE,
    ),
    [currentInventoryPage, filteredInventoryTracker],
  );
  const inventoryPageStart = filteredInventoryTracker.length ? (currentInventoryPage - 1) * INVENTORY_TRACKER_PAGE_SIZE + 1 : 0;
  const inventoryPageEnd = Math.min(currentInventoryPage * INVENTORY_TRACKER_PAGE_SIZE, filteredInventoryTracker.length);
  const bestDay = useMemo(() => bestSalesDay(periodRecords), [periodRecords]);
  const imagePrefetchCandidates = useMemo(
    () => productImageCandidates({
      bestDayItems: bestDay.items,
      filteredInventoryTracker,
      images: dashboardData.images,
      inventoryTracker,
      records: [...periodRecords, ...ytdCurrentRecords],
      topArt,
      visibleInventoryTracker,
      weeklyScorecards,
    }),
    [bestDay.items, dashboardData.images, filteredInventoryTracker, inventoryTracker, periodRecords, topArt, visibleInventoryTracker, weeklyScorecards, ytdCurrentRecords],
  );
  const ytdLine = useMemo(() => ytdPoints(recordsForCustomer, periodEndMonth), [recordsForCustomer, periodEndMonth]);
  const lastUploaded = latestDate(recordsForCustomer);

  const brandOptions = useMemo(() => {
    const options = [...new Set(dashboardData.records.map(brandName))].sort();
    return ["All", ...options];
  }, [dashboardData.records]);

  useEffect(() => {
    setInventoryPage(1);
  }, [brandFilter, inventoryAudienceFilter, inventoryProductFilter, inventorySort, selectedCustomerId, selectedPeriod]);

  useEffect(() => {
    if (inventoryPage > inventoryPageCount) setInventoryPage(inventoryPageCount);
  }, [inventoryPage, inventoryPageCount]);

  useEffect(() => {
    if (!supabase || !selectedCustomerId || !selectedCustomer || !supportsProductImageFetch(selectedCustomer.name)) return;
    const client = supabase;
    const customerId = selectedCustomerId;
    const accountName = selectedCustomer.name;

    const missingRows = imagePrefetchCandidates
      .filter((row) => !row.imageUrl && row.style !== "-")
      .filter((row) => !imageFetchAttempts.current.has(imageAttemptKey(row)))
      .slice(0, IMAGE_PREFETCH_LIMIT);

    if (!missingRows.length) return;
    missingRows.forEach((row) => imageFetchAttempts.current.add(imageAttemptKey(row)));

    let isCancelled = false;

    async function fetchMissingImages() {
      const { data } = await client.auth.getSession();
      const allMatches: RebelRagsImageMatch[] = [];

      for (let index = 0; index < missingRows.length; index += IMAGE_FETCH_BATCH_SIZE) {
        if (isCancelled) return;
        const batch = missingRows.slice(index, index + IMAGE_FETCH_BATCH_SIZE);
        const response = await fetch("/api/rebel-rags-image", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
          },
          body: JSON.stringify({
            accountName,
            items: batch.map((row) => ({
              style: row.style,
              artCode: row.artCode,
              color: row.color,
              styleName: row.styleName,
              parentSku: row.parentSku,
              sku: row.sku,
            })),
          }),
        });

        if (!response.ok) continue;
        const payload = (await response.json()) as { matches?: RebelRagsImageMatch[] };
        allMatches.push(...(payload.matches?.filter((match) => match.imageUrl) ?? []));
      }

      const matchesByKey = new Map<string, RebelRagsImageMatch>();
      allMatches.forEach((match) => matchesByKey.set(imageKey(match.style, match.artCode, match.color), match));
      const matches = [...matchesByKey.values()];
      if (!matches.length) {
        if (!isCancelled) setImagePrefetchRun((run) => run + 1);
        return;
      }

      const rows = matches.map((match) => ({
        customer_id: customerId,
        style_number: match.style,
        art_code: match.artCode,
        color: match.color,
        product_url: match.productUrl,
        image_url: match.imageUrl,
        is_manual_override: match.isManualOverride,
        notes: `Matched from product website using ${match.lookupArtCode}`,
      }));

      const { error } = await client
        .from("product_images")
        .upsert(rows, { onConflict: "customer_id,style_number,art_code,color" });

      if (error || isCancelled) return;

      setDashboardData((current) => ({
        ...current,
        images: mergeProductImages(current.images, matches),
      }));
    }

    fetchMissingImages().catch(() => undefined);

    return () => {
      isCancelled = true;
    };
  }, [imagePrefetchCandidates, imagePrefetchRun, selectedCustomer, selectedCustomerId, supabase]);

  async function signIn() {
    if (!supabase) {
      setStatus("SalesLens is missing Supabase environment variables.");
      return;
    }

    setStatus("Signing in...");
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setStatus(error ? error.message : "");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setStatus("");
  }

  function toggleShareCustomer(customerId: string) {
    setSelectedShareCustomerIds((current) => {
      if (current.includes(customerId)) {
        return current.length === 1 ? current : current.filter((id) => id !== customerId);
      }
      return [...current, customerId];
    });
    setShareStatus("");
    setShareUrl("");
  }

  async function createShareLink(customerIds = selectedShareCustomerIds) {
    if (!supabase || !selectedCustomer || !user || !period || !customerIds.length) return;
    const client = supabase;
    const activeCustomer = selectedCustomer;
    const activePeriod = period;
    const shareCustomers = customers.filter((customer) => customerIds.includes(customer.id));
    if (!shareCustomers.length) return;
    const primaryCustomer = shareCustomers[0];
    if (!primaryCustomer) return;
    const isMultiAccount = shareCustomers.length > 1;

    setShareStatus(isMultiAccount ? "Generating multi-account share link..." : "Generating share link...");
    setShareUrl("");

    const token = createReportToken();
    const generatedAt = new Date().toISOString();

    async function reportForCustomer(customer: Customer) {
      if (customer.id === activeCustomer.id) {
        return buildReportPayload({
          accountName: customer.name,
          brandFilter,
          generatedAt,
          images: dashboardData.images,
          inventoryRecords: dashboardData.inventoryRecords,
          inventorySort,
          period: activePeriod,
          records: dashboardData.records,
          topArtSort,
        });
      }

      const [recordsResult, inventoryResult, imagesResult] = await Promise.all([
        fetchAllRecords(client, customer.id),
        fetchInventoryRecords(client, customer.id),
        fetchProductImages(client, customer.id),
      ]);
      return buildReportPayload({
        accountName: customer.name,
        brandFilter,
        generatedAt,
        images: imagesResult.images,
        inventoryRecords: inventoryResult.records,
        inventorySort,
        period: activePeriod,
        records: recordsResult.records,
        topArtSort,
      });
    }

    const reports = await Promise.all(shareCustomers.map(reportForCustomer));
    const primaryReport = reports[0];
    if (!primaryReport) return;
    const title = isMultiAccount
      ? `${shareCustomers.map((customer) => customer.name).join(" + ")} ${selectedPeriodTitle} Sales Snapshot`
      : `${primaryCustomer.name} ${selectedPeriodTitle} Sales Snapshot`;
    const payload: ReportSnapshotPayload | ReportSnapshotBundlePayload = isMultiAccount
      ? {
          version: 1,
          reportKind: "account_bundle",
          generatedAt,
          accountName: shareCustomers.map((customer) => customer.name).join(" + "),
          brandFilter,
          periodMode: selectedPeriodKind === "month" ? "monthly" : "ytd",
          selectedMonth: periodEndMonth,
          periodTitle: selectedPeriodTitle,
          priorPeriodTitle,
          reports,
        }
      : primaryReport;

    const { error } = await client.from("report_snapshots").insert({
      token,
      title,
      customer_id: isMultiAccount ? null : primaryCustomer.id,
      created_by: user.id,
      payload,
    });

    if (error) {
      setShareStatus(error.message);
      return;
    }

    const url = `${window.location.origin}/share/${token}`;
    setShareUrl(url);
    setShareStatus("Share link ready.");
    await navigator.clipboard?.writeText(url).catch(() => undefined);
  }

  function beginImportFiles(files: File[]) {
    if (files.length === 0 || !selectedCustomer) return;
    setPendingImportFiles((current) => [...current, ...files]);
  }

  function closeImportModal() {
    setImportModalOpen(false);
    setPendingImportFiles([]);
    setImportRangeStart("");
    setImportRangeEnd("");
    setCustomerStatus("");
  }

  function removePendingImportFile(indexToRemove: number) {
    setPendingImportFiles((files) => files.filter((_file, index) => index !== indexToRemove));
  }

  function selectedImportRange(): SalesImportOptions | null {
    if (!importRangeStart && !importRangeEnd) return {};
    if (!importRangeStart || !importRangeEnd) {
      setCustomerStatus("Choose both a start and end date, or leave both dates blank.");
      return null;
    }
    if (importRangeStart > importRangeEnd) {
      setCustomerStatus("The upload start date must be before the end date.");
      return null;
    }
    return {
      reportStartDate: importRangeStart,
      reportEndDate: importRangeEnd,
    };
  }

  async function importSalesFiles(files: File[], options: SalesImportOptions = {}) {
    if (files.length === 0) return;
    setCustomerStatus("");
    let imported = 0;
    for (const [index, file] of files.entries()) {
      setImportStatus(`Importing sales file ${index + 1} of ${files.length}: ${file.name}`);
      const success = await importSalesFile(file, options);
      if (success) imported += 1;
    }
    setImportStatus(`Finished sales import: ${numberText(imported)} of ${numberText(files.length)} files imported.`);
    setSelectedPeriod(null);
    setReloadKey((key) => key + 1);
  }

  async function importInventoryFiles(files: File[]) {
    if (files.length === 0) return;
    setCustomerStatus("");
    let imported = 0;
    for (const [index, file] of files.entries()) {
      setImportStatus(`Importing inventory file ${index + 1} of ${files.length}: ${file.name}`);
      const success = await importInventoryFile(file);
      if (success) imported += 1;
    }
    setImportStatus(`Finished inventory import: ${numberText(imported)} of ${numberText(files.length)} files imported.`);
    setReloadKey((key) => key + 1);
  }

  async function importSalesFile(file: File | null, options: SalesImportOptions = {}) {
    if (!file || !supabase || !selectedCustomer || !user) return false;

    setImportStatus(`Reading ${file.name}...`);
    try {
      const parsed = await parseSalesWorkbook(file, selectedCustomer.name, options);
      if (parsed.records.length === 0) {
        setImportStatus(`No importable records found. Skipped ${parsed.skippedCount} rows.`);
        return false;
      }

      if (isRebelRagsCustomer(selectedCustomer.name)) {
        const totalSales = sum(parsed.records.map((record) => record.amount));
        const totalUnits = sum(parsed.records.map((record) => record.units ?? 0));
        const uploadId = await createUploadBatch(supabase, {
          customerId: selectedCustomer.id,
          fileName: file.name,
          userId: user.id,
          receivedDate: parsed.receivedDate,
          salesPeriodStart: parsed.salesPeriodStart,
          salesPeriodEnd: parsed.salesPeriodEnd,
          rowCount: parsed.records.length,
          skippedCount: parsed.skippedCount,
          totalSales,
          totalUnits,
          status: "imported",
        });

        setImportStatus(`Replacing overlapping Rebel Rags sales records...`);
        await replaceSalesRecordsForPeriodAndBrands(supabase, selectedCustomer.id, parsed.records, uploadId);

        setImportStatus(
          `Imported ${numberText(parsed.records.length)} records from ${file.name}. Replaced matching date and brand/class records for this upload range. Skipped ${numberText(parsed.skippedCount)} rows.`,
        );
        return true;
      }

      setImportStatus(`Checking for duplicate records...`);
      const existingKeys = await loadExistingRecordKeys(
        supabase,
        selectedCustomer.id,
        parsed.salesPeriodStart,
        parsed.salesPeriodEnd,
      );
      const newRecords = parsed.records.filter((record) => !existingKeys.has(recordKey(record)));
      const duplicateCount = parsed.records.length - newRecords.length;

      const totalSales = sum(newRecords.map((record) => record.amount));
      const totalUnits = sum(newRecords.map((record) => record.units ?? 0));
      const uploadId = await createUploadBatch(supabase, {
        customerId: selectedCustomer.id,
        fileName: file.name,
        userId: user.id,
        receivedDate: parsed.receivedDate,
        salesPeriodStart: parsed.salesPeriodStart,
        salesPeriodEnd: parsed.salesPeriodEnd,
        rowCount: newRecords.length,
        skippedCount: parsed.skippedCount + duplicateCount,
        totalSales,
        totalUnits,
        status: newRecords.length ? "imported" : "duplicate",
      });

      if (newRecords.length > 0) {
        setImportStatus(`Saving ${numberText(newRecords.length)} records...`);
        await insertSalesRecords(supabase, selectedCustomer.id, uploadId, newRecords);
      }

      setImportStatus(
        `Imported ${numberText(newRecords.length)} records from ${file.name}. Skipped ${numberText(parsed.skippedCount)} rows and ${numberText(duplicateCount)} duplicates.`,
      );
      return true;
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Import failed.");
      return false;
    }
  }

  async function importInventoryFile(file: File | null) {
    if (!file || !supabase || !selectedCustomer || !user) return false;

    setImportStatus(`Reading inventory from ${file.name}...`);
    try {
      const parsed = await parseInventoryWorkbook(file, selectedCustomer.name);
      if (parsed.records.length === 0) {
        setImportStatus(`No importable inventory records found. Skipped ${parsed.skippedCount} rows.`);
        return false;
      }

      const inventoryDates = [...new Set(parsed.records.map((record) => record.inventory_date))].sort();
      const totalUnits = sum(parsed.records.map((record) => record.inventory_units));
      const uploadId = await createUploadBatch(supabase, {
        customerId: selectedCustomer.id,
        fileName: file.name,
        userId: user.id,
        receivedDate: parsed.inventoryDate,
        salesPeriodStart: inventoryDates[0] ?? parsed.inventoryDate,
        salesPeriodEnd: inventoryDates.at(-1) ?? parsed.inventoryDate,
        rowCount: parsed.records.length,
        skippedCount: parsed.skippedCount,
        totalSales: 0,
        totalUnits,
        status: "imported",
      });

      setImportStatus(`Saving ${numberText(parsed.records.length)} inventory records...`);
      await replaceInventoryRecordsForDates(supabase, selectedCustomer.id, inventoryDates, parsed.records, uploadId);

      setImportStatus(
        `Imported ${numberText(parsed.records.length)} inventory records from ${file.name}. Skipped ${numberText(parsed.skippedCount)} rows.`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Inventory import failed.";
      setImportStatus(inventoryErrorMessage(message) || message);
      return false;
    }
  }

  if (user) {
    return (
      <main className={`appShell ${accountThemeClass(selectedCustomer?.name)}`}>
        <nav className={navCompact ? "topNav compact" : "topNav"} aria-label="SalesLens controls">
          <div className="navBrand">
            <h1>SalesLens</h1>
            <p>by Lester Sales</p>
          </div>

          <div className="navControls">
            <label className="navField">
              <span>Account</span>
              <select
                value={selectedCustomerId ?? ""}
                onChange={(event) => {
                  setSelectedCustomerId(event.target.value);
                  setSelectedPeriod(null);
                  setBrandFilter("All");
                }}
              >
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="navUploadField">
              <div className="navDateMeta">
                <p>Last Upload:</p>
                <strong>{compactDateText(lastUploaded)}</strong>
              </div>
              <button
                className="fileButton"
                onClick={() => {
                  setCustomerStatus("");
                  setImportModalOpen(true);
                }}
                type="button"
              >
                Upload / Import
              </button>
              {(customerStatus || importStatus) ? (
                <div className="navMessage">
                  <span>{importStatus || customerStatus}</span>
                  <button
                    aria-label="Dismiss message"
                    onClick={() => {
                      setImportStatus("");
                      setCustomerStatus("");
                    }}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ) : null}
            </div>

            <div className="navSignOutField">
              <span>{user.email ?? "Signed in"}</span>
              <button className="ghostButton navSignOut" onClick={signOut}>
                Sign Out
              </button>
            </div>
          </div>
        </nav>

        {importModalOpen ? (
          <div className="modalOverlay" role="presentation">
            <section className="shareModal importTypeModal" role="dialog" aria-modal="true" aria-labelledby="import-type-title">
              <button
                aria-label="Close import type"
                className="modalCloseButton"
                onClick={closeImportModal}
              >
                X
              </button>
              <p className="eyebrow">{selectedCustomer?.name ?? "Account"} Import</p>
              <h3 id="import-type-title">What are you uploading?</h3>
              <div className="importFilePicker">
                <label className="browseButton">
                  Browse
                  <input
                    accept=".xls,.xlsx,.csv"
                    multiple
                    type="file"
                    onChange={(event) => {
                      beginImportFiles(Array.from(event.target.files ?? []));
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <div className="selectedFileList">
                  {pendingImportFiles.length ? (
                    pendingImportFiles.map((file, index) => (
                      <span className="selectedFilePill" key={`${file.name}-${file.lastModified}-${index}`}>
                        <span>{file.name}</span>
                        <button
                          aria-label={`Remove ${file.name}`}
                          onClick={() => removePendingImportFile(index)}
                          type="button"
                        >
                          X
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="selectedFileEmpty">No file selected</span>
                  )}
                </div>
              </div>
              {pendingImportFiles.length > 1 ? (
                <p className="muted">
                  Files will import one at a time in the order selected.
                </p>
              ) : null}
              {customerStatus ? <p className="shareStatus">{customerStatus}</p> : null}
              <div className="importDateRange">
                <div>
                  <strong>Sales report date range</strong>
                  <span>Optional. Use this when the file covers a weekly or custom range.</span>
                </div>
                <label>
                  <span>Start</span>
                  <input
                    type="date"
                    value={importRangeStart}
                    onChange={(event) => setImportRangeStart(event.target.value)}
                  />
                </label>
                <label>
                  <span>End</span>
                  <input
                    type="date"
                    value={importRangeEnd}
                    onChange={(event) => setImportRangeEnd(event.target.value)}
                  />
                </label>
              </div>
              <div className="shareScopeGrid">
                <button
                  disabled={pendingImportFiles.length === 0}
                  onClick={() => {
                    const range = selectedImportRange();
                    if (!range) return;
                    const files = pendingImportFiles;
                    closeImportModal();
                    void importSalesFiles(files, range);
                  }}
                  type="button"
                >
                  <strong>Sales Data</strong>
                  <span>POS sales with units and dollars. The selected date range applies to every file in this upload.</span>
                </button>
                <button
                  disabled={pendingImportFiles.length === 0}
                  onClick={() => {
                    const files = pendingImportFiles;
                    closeImportModal();
                    void importInventoryFiles(files);
                  }}
                  type="button"
                >
                  <strong>Inventory Report</strong>
                  <span>Standalone on-hand units by product/style/color/artwork.</span>
                </button>
              </div>
            </section>
          </div>
        ) : null}

        <section className="dashboard">
          <header className="dashboardHeader">
            <div>
              <p className="eyebrow">Sales Snapshot</p>
              <h2>{selectedCustomer?.name ?? "Account"}</h2>
              <p className="muted">Compare YTD pace, monthly sales movement, inventory signals, and top-performing styles and art.</p>
            </div>

            <div className="controlDock">
              <label>
                Brand/Class
                <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
                  {brandOptions.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Period
                <select
                  value={selectedPeriodValue ?? ""}
                  onChange={(event) => setSelectedPeriod(event.target.value)}
                >
                  {periodOptions.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <button
                className="shareButton"
                onClick={() => {
                  setShareModalOpen(true);
                  setSelectedShareCustomerIds(selectedCustomerId ? [selectedCustomerId] : []);
                  setShareStatus("");
                  setShareUrl("");
                }}
                disabled={!periodRecords.length}
              >
                Share Report
              </button>
            </div>
          </header>

          {shareModalOpen ? (
            <div className="modalOverlay" role="presentation">
              <section className="shareModal" role="dialog" aria-modal="true" aria-labelledby="share-report-title">
                <button
                  aria-label="Close share report"
                  className="modalCloseButton"
                  onClick={() => {
                    setShareModalOpen(false);
                    setShareStatus("");
                    setShareUrl("");
                  }}
                >
                  X
                </button>
                <p className="eyebrow">Share Snapshot</p>
                <h3 id="share-report-title">Create report link</h3>
                <p>Select one account for an account-only link, or select multiple accounts for a combined review.</p>

                <div className="shareAccountToggles" aria-label="Share report accounts">
                  {customers.map((customer) => {
                    const isSelected = selectedShareCustomerIds.includes(customer.id);
                    return (
                      <button
                        aria-pressed={isSelected}
                        className={isSelected ? "active" : ""}
                        key={customer.id}
                        onClick={() => toggleShareCustomer(customer.id)}
                        type="button"
                      >
                        {customer.name}
                      </button>
                    );
                  })}
                </div>

                <button className="shareGenerateButton" onClick={() => createShareLink()} disabled={!selectedShareCustomerIds.length || shareStatus.includes("Generating")}>
                  Generate {selectedShareCustomerIds.length > 1 ? "Multi-Account" : "Account"} Link
                </button>

                {shareStatus ? <p className="shareStatus">{shareStatus}</p> : null}
                {shareUrl ? (
                  <div className="shareLinkBox">
                    <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
                    <button className="ghostButton" onClick={() => navigator.clipboard?.writeText(shareUrl)}>
                      Copy Link
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          <section className="overviewStrip" aria-label="Current dashboard context">
            <article>
              <span>Imported Transactions</span>
              <strong>{numberText(currentMetrics.transactions)}</strong>
            </article>
            <article>
              <span>Last Date Uploaded</span>
              <strong>{dateText(lastUploaded)}</strong>
            </article>
          </section>

          {dashboardStatus ? <section className="notice">{dashboardStatus}</section> : null}
          {!dashboardStatus && periodRecords.length === 0 ? (
            <section className="notice">No records match the current account, period, and brand/class filters.</section>
          ) : null}

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>{selectedPeriodKind === "year" ? "Year Scorecard" : "YTD Scorecard"}</h3>
                <p>{ytdTitle(periodEndMonth)} compared with the same date range last year.</p>
              </div>
              <strong className={`changeBadge ${changeClass(ytdLine.currentTotal - ytdLine.priorTotal)}`}>
                {changeText(ytdLine.currentTotal, ytdLine.priorTotal)}
              </strong>
            </div>

            <div className="ytdTrackerLayout">
              <MiniLineChart current={ytdLine.current} prior={ytdLine.prior} currentYear={selectedYear} />

              <div className="ytdTrackerTiles">
                <MetricCard label={selectedYear ? `${selectedYear} YTD` : "Current YTD"} value={currencyText(ytdLine.currentTotal)} />
                <MetricCard label={selectedYear ? `${selectedYear - 1} YTD` : "Prior YTD"} value={currencyText(ytdLine.priorTotal)} />
                <MetricCard label="Total Change" value={currencyText(ytdLine.currentTotal - ytdLine.priorTotal)} tone={ytdLine.currentTotal - ytdLine.priorTotal} />
                <YtdInsightCard
                  label="Avg Monthly Sales"
                  value={currencyText(ytdInsights.averageMonthlySales)}
                  detail={`${currencyText(ytdInsights.priorAverageMonthlySales)} LY`}
                  tone={ytdInsights.averageMonthlySales - ytdInsights.priorAverageMonthlySales}
                />
                <ProductBreadthCard insights={ytdInsights} />
              </div>
            </div>
          </section>

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>{selectedPeriodKind === "year" ? "Selected Year Scorecard" : "Monthly Scorecard"}</h3>
                <p>{selectedPeriodTitle} compared with {priorPeriodTitle}.</p>
              </div>
            </div>

            <SalesDriverGrid
              bestDay={bestDay}
              current={currentMetrics}
              drivers={monthlyDrivers}
              periodTitle={selectedPeriodTitle}
              prior={priorMetrics}
            />
          </section>

          {selectedPeriodKind === "month" && weeklyScorecards.length ? (
            <section className="sectionBlock">
              <div className="sectionTitle">
                <div>
                  <h3>Weekly Scorecard</h3>
                  <p>Monday-Sunday sales weeks inside {selectedPeriodTitle}, compared with the same weekday range last year.</p>
                </div>
              </div>
              <WeeklyScorecard rows={weeklyScorecards} />
            </section>
          ) : null}

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>Style Comparison</h3>
                <p>
                  {styleStudyMode === "month"
                    ? `Top 10 Styles: ${selectedPeriodTitle} vs ${priorPeriodTitle}`
                    : "Top 10 Styles vs Last YTD"}
                </p>
              </div>
            </div>
            <div className="studyTabs" aria-label="Style study views">
              <button className={styleStudyMode === "month" ? "active" : ""} onClick={() => setStyleStudyMode("month")}>
                {selectedPeriodKind === "year" ? "Selected Year" : "Current Month"}
              </button>
              <button className={styleStudyMode === "ytd" ? "active" : ""} onClick={() => setStyleStudyMode("ytd")}>
                YTD
              </button>
            </div>
            <div className="styleComparisonGrid">
              {(styleStudyMode === "month" ? periodStyleStudy : ytdStyleStudy).map((style) => (
                <StyleComparisonCard key={style.style} style={style} compareLabel="LY" />
              ))}
            </div>
          </section>

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>Top Performing Styles</h3>
                <p>
                  {selectedPeriodTitle} Top 30 by {topArtSort === "units" ? "Units" : "Dollars"}: {numberText(sum(topArt.map((row) => row.units)))} Units |{" "}
                  {currencyText(sum(topArt.map((row) => row.sales)))}
                </p>
              </div>
              <div className="sortControls" aria-label="Top performing styles sort controls">
                <span>Sort by:</span>
                <button
                  className={topArtSort === "units" ? "active" : ""}
                  type="button"
                  onClick={() => setTopArtSort("units")}
                >
                  Units
                </button>
                <button
                  className={topArtSort === "dollars" ? "active" : ""}
                  type="button"
                  onClick={() => setTopArtSort("dollars")}
                >
                  Dollars
                </button>
              </div>
            </div>
            <div className="artGrid">
              {topArt.map((row) => (
                <article className="artCard" key={row.key}>
                  <div className="artImage">
                    <b>#{row.rank}</b>
                    {row.imageUrl ? <img src={row.imageUrl} alt={`${row.style} ${row.artCode}`} /> : <span>No Image</span>}
                  </div>
                  <div className="artMeta">
                    {row.productUrl ? (
                      <a className="artCodeLink" href={row.productUrl} target="_blank" rel="noreferrer">
                        {row.artCode}
                      </a>
                    ) : (
                      <strong>{row.artCode}</strong>
                    )}
                    <span>{row.style} | {row.color}</span>
                    <span>{selectedPeriodKind === "year" ? "Year" : "Month"}: {numberText(row.units)} Units | {wholeCurrencyText(row.sales)}</span>
                    {selectedPeriodKind === "month" ? (
                      <span>YTD: {numberText(row.cyUnits)} Units | {wholeCurrencyText(row.cySales)}</span>
                    ) : null}
                    {row.inventoryUnits != null ? (
                      <span>{inventoryLabel(row)}</span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {inventorySnapshot ? (
            <section className="sectionBlock inventorySection">
              <div className="sectionTitle">
                <div>
                  <h3>Inventory Snapshot</h3>
                  <p>Current on-hand inventory from the latest available inventory data.</p>
                </div>
                <strong>{dateText(inventorySnapshot.date)}</strong>
              </div>
              <InventoryCard snapshot={inventorySnapshot} />
            </section>
          ) : null}

          {inventoryTracker.length ? (
            <section className="sectionBlock">
              <div className="sectionTitle">
                <div>
                  <h3>Inventory Tracker</h3>
                  <p>
                    {inventorySort === "highest" ? "Highest" : "Lowest"} {numberText(filteredInventoryTracker.length)} current on-hand items with 5+ units, plus high-demand low-stock exceptions. Showing{" "}
                    {numberText(inventoryPageStart)}-{numberText(inventoryPageEnd)} |{" "}
                    {numberText(sum(filteredInventoryTracker.map((row) => row.inventoryUnits)))} Units
                  </p>
                </div>
              </div>
              <div className="inventoryControls">
                <div className="inventoryFilterStack">
                  <div className="inventoryControlGroup sortControls" aria-label="Inventory sort controls">
                    <span>Sort by:</span>
                    <button
                      className={inventorySort === "highest" ? "active" : ""}
                      type="button"
                      onClick={() => setInventorySort("highest")}
                    >
                      Highest
                    </button>
                    <button
                      className={inventorySort === "lowest" ? "active" : ""}
                      type="button"
                      onClick={() => setInventorySort("lowest")}
                    >
                      Lowest
                    </button>
                  </div>
                  <div className="inventoryControlGroup inventoryFilters" aria-label="Inventory filters">
                    <span>Filter:</span>
                    <button
                      className={inventoryAudienceFilter === "All" && inventoryProductFilter === "All" ? "active" : ""}
                      type="button"
                      onClick={() => {
                        setInventoryAudienceFilter("All");
                        setInventoryProductFilter("All");
                      }}
                    >
                      All
                    </button>
                    {(["Mens", "Womens", "Youth"] as InventoryAudienceFilter[]).map((filter) => (
                      <button
                        className={inventoryAudienceFilter === filter ? "active" : ""}
                        key={filter}
                        type="button"
                        onClick={() => setInventoryAudienceFilter((current) => current === filter ? "All" : filter)}
                      >
                        {filter === "Womens" ? "Women's" : filter}
                      </button>
                    ))}
                    {(["Fleece", "Tees", "Reverse Weave"] as InventoryProductFilter[]).map((filter) => (
                      <button
                        className={inventoryProductFilter === filter ? "active" : ""}
                        key={filter}
                        type="button"
                        onClick={() => setInventoryProductFilter((current) => current === filter ? "All" : filter)}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>
                {inventoryPageCount > 1 ? (
                  <div className="pagerControls" aria-label="Inventory page controls">
                    <button
                      disabled={currentInventoryPage <= 1}
                      type="button"
                      onClick={() => setInventoryPage((page) => Math.max(1, page - 1))}
                    >
                      Prev
                    </button>
                    <span>Page {numberText(currentInventoryPage)} of {numberText(inventoryPageCount)}</span>
                    <button
                      disabled={currentInventoryPage >= inventoryPageCount}
                      type="button"
                      onClick={() => setInventoryPage((page) => Math.min(inventoryPageCount, page + 1))}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </div>
              {visibleInventoryTracker.length ? (
                <div className="artGrid">
                  {visibleInventoryTracker.map((row) => (
                    <article className="artCard" key={row.key}>
                      <div className="artImage">
                        <b>#{row.rank}</b>
                        {row.imageUrl ? <img src={row.imageUrl} alt={`${row.style} ${row.artCode}`} /> : <span>No Image</span>}
                      </div>
                      <div className="artMeta">
                        {row.productUrl ? (
                          <a className="artCodeLink" href={row.productUrl} target="_blank" rel="noreferrer">
                            {row.artCode}
                          </a>
                        ) : (
                          <strong>{row.artCode}</strong>
                        )}
                        <span>{row.style} | {row.color}</span>
                        <span>Current Inv: {numberText(row.inventoryUnits)} Units</span>
                        <span>YTD Sold: {numberText(row.ytdUnits)} Units</span>
                        <span>LY Sold: {inventoryPriorYearSoldText(row.priorYearUnits)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="emptyNotice">No inventory items match the selected filters.</p>
              )}
            </section>
          ) : null}

          <p className="dataFootnote">
            All imported records for this account/filter: {numberText(totalRecordsMetrics.transactions)} transactions,{" "}
            {numberText(totalRecordsMetrics.units)} units, {currencyText(totalRecordsMetrics.sales)}.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="loginShell">
      <section className="loginPanel">
        <div className="loginMark" aria-hidden="true">
          <span>SL</span>
        </div>
        <p className="eyebrow">SalesLens by Lester Sales</p>
        <h1>Welcome back</h1>
        <p className="intro">Sign in to review sports merchandise sales, compare trends, and share account snapshots.</p>

        <form
          className="loginFields"
          onSubmit={(event) => {
            event.preventDefault();
            signIn();
          }}
        >
          <label htmlFor="email">Email address</label>
          <input
            autoComplete="email"
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ryanlestersells@gmail.com"
          />

          <label htmlFor="password">Password</label>
          <input
            autoComplete="current-password"
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
          />
          <button className="loginButton" type="submit" disabled={!email || !password}>
            Sign In
          </button>
        </form>
        {status ? <p className="status">{status}</p> : null}
      </section>
    </main>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <article className={`metric ${tone == null ? "" : changeClass(tone)}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function accountThemeClass(name?: string | null) {
  const normalized = (name ?? "").toLowerCase();
  if (normalized.includes("rebel")) return "accountThemeRebelRags";
  if (normalized.includes("volshop") || normalized.includes("vol shop")) return "accountThemeVolshop";
  return "accountThemeDefault";
}

function YtdInsightCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: number }) {
  return (
    <article className="ytdInsightCard">
      <p>{label}</p>
      <strong>{value}</strong>
      <span className={changeClass(tone)}>{detail}</span>
    </article>
  );
}

function ProductBreadthCard({ insights }: { insights: ReturnType<typeof ytdInsightMetrics> }) {
  return (
    <article className="ytdInsightCard productBreadthCard">
      <p>Styles / Colors / Artworks</p>
      <div>
        <span>
          <strong>{numberText(insights.stylesSold)}</strong>
          Styles
          <em>{numberText(insights.priorStylesSold)} LY</em>
        </span>
        <span>
          <strong>{numberText(insights.colorsSold)}</strong>
          Colors
          <em>{numberText(insights.priorColorsSold)} LY</em>
        </span>
        <span>
          <strong>{numberText(insights.artworksSold)}</strong>
          Artworks
          <em>{numberText(insights.priorArtworksSold)} LY</em>
        </span>
      </div>
    </article>
  );
}

function SalesDriverGrid({
  bestDay,
  current,
  prior,
  drivers,
  periodTitle,
}: {
  bestDay: ReturnType<typeof bestSalesDay>;
  current: MetricSet;
  prior: MetricSet;
  drivers: ReturnType<typeof monthlyDriverMetrics>;
  periodTitle: string;
}) {
  const salesDelta = current.sales - prior.sales;

  return (
    <div className="salesDriverGrid">
      <article className="driverTile monthlySalesCard">
        <div className="monthlySalesHeader">
          <p>Sales</p>
        </div>
        <div className="monthlySalesStory">
          <span>
            <em>Sales Change</em>
            <strong className={changeClass(salesDelta)}>{changeText(current.sales, prior.sales)}</strong>
          </span>
          <span>
            <em>Dollar Gap</em>
            <strong className={changeClass(salesDelta)}>{signedCurrencyText(salesDelta)}</strong>
          </span>
        </div>
        <div className="monthlySalesPair">
          <span>
            <em>{periodTitle}</em>
            <strong>{currencyText(current.sales)}</strong>
          </span>
          <span>
            <em>Last Year</em>
            <strong>{currencyText(prior.sales)}</strong>
          </span>
        </div>
      </article>
      <TopSalesItemsCard bestDay={bestDay} periodTitle={periodTitle} />
      <DriverTile
        label="Transactions"
        value={`${numberText(current.transactions)} vs ${numberText(prior.transactions)} LY`}
        details={[
          `Change: ${changeText(current.transactions, prior.transactions)}`,
          `Avg sale: ${currencyText(drivers.avgSalePerTransaction)} vs ${currencyText(drivers.priorAvgSalePerTransaction)} LY`,
        ]}
        tone={current.transactions - prior.transactions}
      />
      <DriverTile
        label="Units"
        value={`${numberText(current.units)} vs ${numberText(prior.units)} LY`}
        details={[
          `Change: ${changeText(current.units, prior.units)}`,
          `Avg $ / unit: ${currencyText(drivers.avgSalePerUnit)} vs ${currencyText(drivers.priorAvgSalePerUnit)} LY`,
        ]}
        tone={current.units - prior.units}
      />
      <DriverTile
        label="Top Style Dependence"
        value={`${drivers.topFiveStyleShare.toFixed(1)}%`}
        details={[`Top 5 styles: ${currencyText(drivers.topFiveStyleSales)}`]}
        tone={0}
      />
    </div>
  );
}

function DriverTile({ label, value, details, tone }: { label: string; value: string; details: string[]; tone: number }) {
  return (
    <article className={`driverTile ${changeClass(tone)}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <div className="driverMeta">
        {details.map((detail) => (
          <span key={detail}>{detail}</span>
        ))}
      </div>
    </article>
  );
}

function WeeklyScorecard({ rows }: { rows: WeeklyScorecardRow[] }) {
  return (
    <div className="weeklyScorecardList">
      {rows.map((row) => {
        const salesDelta = row.current.sales - row.prior.sales;
        const unitsDelta = row.current.units - row.prior.units;
        const transactionDelta = row.current.transactions - row.prior.transactions;
        return (
          <article className="weeklyScorecardRow" key={row.dateRange}>
            <div className="weeklyDateRail">
              <span>Week {row.rank}</span>
              <strong>{row.dateRange}</strong>
              <em>{countText(row.dayCount, "day", "days")}</em>
            </div>

            <div className="weeklyPrimary">
              <span>Sales</span>
              <strong>{currencyText(row.current.sales)}</strong>
              <em className={changeClass(salesDelta)}>
                {changeText(row.current.sales, row.prior.sales)} | {signedCurrencyText(salesDelta)}
              </em>
            </div>

            <div className="weeklyMetrics">
              <span>
                <em>Units</em>
                <strong>{numberText(row.current.units)}</strong>
                <small className={changeClass(unitsDelta)}>{signedNumberText(unitsDelta)} vs LY</small>
              </span>
              <span>
                <em>Transactions</em>
                <strong>{numberText(row.current.transactions)}</strong>
                <small className={changeClass(transactionDelta)}>{signedNumberText(transactionDelta)} vs LY</small>
              </span>
              <span>
                <em>Avg Sale</em>
                <strong>{currencyText(row.avgSalePerTransaction)}</strong>
                <small>per transaction</small>
              </span>
            </div>

            <div className="weeklyTopProducts">
              <span>Top 3 Products</span>
              {row.topItems.length ? (
                <div className="weeklyTopProductList">
                  {row.topItems.map((item) => (
                    <div className="weeklyTopProduct" key={`${item.style}-${item.artCode}-${item.color}`}>
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={`${item.style} ${item.artCode}`} />
                      ) : (
                        <div className="weeklyTopProductPlaceholder">No Image</div>
                      )}
                      <div>
                        <strong>{item.artCode}</strong>
                        <em>{item.style} | {item.color}</em>
                        <small>{numberText(item.units)} units | {currencyText(item.sales)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <strong>No sales</strong>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function InventoryCard({ snapshot }: { snapshot: InventorySnapshot }) {
  if (!snapshot) return null;
  return (
    <article className="inventoryCard">
      <div className="inventoryTotal">
        <span>On Hand Units</span>
        <strong>{numberText(snapshot.totalUnits)}</strong>
      </div>
      <div className="inventorySummaryGrid">
        <div>
          <span>Styles In Stock</span>
          <strong>{numberText(snapshot.styles)}</strong>
        </div>
        <div>
          <span>Artworks In Stock</span>
          <strong>{numberText(snapshot.artworks)}</strong>
        </div>
      </div>
      <div className="inventoryBreakout">
        {snapshot.byBrand.map((row) => (
          <div key={row.brand}>
            <span>{row.brand}</span>
            <strong>{numberText(row.units)} Units</strong>
          </div>
        ))}
      </div>
      <div className="inventoryCoverage">
        <span>Inventory Coverage</span>
        <strong>{snapshot.coverage == null ? "-" : `${snapshot.coverage.toFixed(1)}x`}</strong>
        <p>
          {snapshot.coverage == null
            ? "Current inventory is not comparable to the selected period's selling pace."
            : `Based on the normalized monthly sales pace, available inventory would cover about ${snapshot.coverage.toFixed(1)} months at this pace.`}
          {" "}
          This helps show whether stock looks heavy, lean, or balanced against recent demand.
        </p>
      </div>
      <InventoryPositionCard position={snapshot.position} />
      {snapshot.line ? <InventoryLineChart line={snapshot.line} /> : null}
    </article>
  );
}

function InventoryPositionCard({ position }: { position: InventoryPosition }) {
  return (
    <div className="inventoryPosition">
      <div className="inventoryPositionHeader">
        <span>Inventory Position</span>
        <strong>{position.label}</strong>
      </div>
      <div className="inventoryGauge" aria-label={`Inventory position is ${position.label}`}>
        <div className="inventoryGaugeLabels">
          <span>Lean</span>
          <span>Heavy</span>
        </div>
        <div className="inventoryGaugeTrack">
          <i style={{ left: `${position.score}%` }} />
        </div>
      </div>
      <p>{position.headline}</p>
      <small>{position.detail}</small>
      <em>{position.comparison}</em>
    </div>
  );
}

function InventoryLineChart({ line }: { line: InventoryLine }) {
  return (
    <MiniLineChart
      ariaLabel="Inventory units on hand by month"
      className="inventoryTrendChart"
      current={line.current}
      currentLabel={String(line.currentYear)}
      currentYear={line.currentYear}
      prior={line.prior}
      priorLabel={String(line.priorYear)}
    />
  );
}

function TopSalesItemsCard({ bestDay, periodTitle }: { bestDay: ReturnType<typeof bestSalesDay>; periodTitle: string }) {
  const maxUnits = Math.max(...bestDay.items.map((item) => item.units), 1);
  const hasDailySales = bestDay.dayCount > 1;
  return (
    <article className="insightCard topSalesItemsCard">
      <div className="cardHeading">
        <h4>{hasDailySales ? "Best Sales Day" : "Top Sales Items"}</h4>
        <strong>{hasDailySales ? dateText(bestDay.date) : periodTitle}</strong>
      </div>
      <p className="compactLine">
        {currencyText(bestDay.sales)} | {numberText(bestDay.units)} units
        {hasDailySales ? ` | ${numberText(bestDay.transactions)} transactions` : ""}
      </p>
      {bestDay.items.map((item) => (
        <div className="bestRow" key={`${item.style}-${item.artCode}-${item.color}`}>
          <strong className="bestItem">
            <span>
              #{item.rank} {item.style}
              <small>{numberText(item.units)} | {currencyText(item.sales)}</small>
            </span>
            <small>{item.artCode} | {item.color}</small>
          </strong>
          <span className="barTrack"><span style={{ width: `${(item.units / maxUnits) * 100}%` }} /></span>
        </div>
      ))}
    </article>
  );
}

function StyleComparisonCard({ style, compareLabel }: { style: TopStyle; compareLabel: string }) {
  const maxUnits = Math.max(style.units, style.priorUnits, 1);
  const unitDelta = style.units - style.priorUnits;
  return (
    <article className="styleCompareCard">
      <div className="styleCompareTop">
        <strong>#{style.rank} {style.style}</strong>
        <span>{style.brand}</span>
        <em className={changeClass(unitDelta)}>
          {unitDelta >= 0 ? "+" : "-"}
          {numberText(Math.abs(unitDelta))} units
        </em>
        <em className={changeClass(style.sales - style.priorSales)}>{currencyText(style.sales - style.priorSales)}</em>
      </div>
      <p>
        CY:{" "}
        <span className={changeClass(style.colorCount - style.priorColorCount)}>
          {countText(style.colorCount, "Color", "Colors")}
        </span>
        ,{" "}
        <span className={changeClass(style.artCount - style.priorArtCount)}>
          {countText(style.artCount, "Artwork", "Artworks")}
        </span>{" "}
        | {compareLabel}:{" "}
        <span className={changeClass(style.priorColorCount - style.colorCount)}>
          {countText(style.priorColorCount, "Color", "Colors")}
        </span>
        ,{" "}
        <span className={changeClass(style.priorArtCount - style.artCount)}>
          {countText(style.priorArtCount, "Artwork", "Artworks")}
        </span>
      </p>
      <div className="styleBars">
        <CompareUnitBar label="CY" value={style.units} max={maxUnits} />
        <CompareUnitBar label={compareLabel} value={style.priorUnits} max={maxUnits} secondary />
      </div>
    </article>
  );
}

function CompareUnitBar({ label, value, max, secondary = false }: { label: string; value: number; max: number; secondary?: boolean }) {
  return (
    <div className="unitBar">
      <span>{label}</span>
      <div className={`barTrack ${secondary ? "secondary" : ""}`}>
        <span style={{ width: `${Math.max(3, (value / max) * 100)}%` }} />
      </div>
      <strong>{numberText(value)}</strong>
    </div>
  );
}

function MiniLineChart({
  ariaLabel = "Comparative sales by month",
  className = "",
  current,
  currentLabel,
  prior,
  priorLabel,
  currentYear,
}: {
  ariaLabel?: string;
  className?: string;
  current: Array<number | null>;
  currentLabel?: string;
  prior: Array<number | null>;
  priorLabel?: string;
  currentYear: number | null;
}) {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const currentValues = padMonths(current);
  const priorValues = padMonths(prior);
  const numericValues = [...currentValues, ...priorValues].filter((value): value is number => typeof value === "number");
  const maxValue = Math.max(...numericValues, 1);
  const currentMonthCount = Math.max(1, lastActiveMonthIndex(currentValues) + 1);
  const priorMonthCount = Math.max(1, lastActiveMonthIndex(priorValues) + 1);
  const displayedCurrent = currentValues.slice(0, currentMonthCount);
  const displayedPrior = priorValues.slice(0, priorMonthCount);
  const xFor = (index: number) => 12 + (index / 11) * 164;
  const yFor = (value: number) => 78 - (value / maxValue) * 66;
  const lineSegments = (values: Array<number | null>) => {
    const segments: string[][] = [];
    let currentSegment: string[] = [];
    values.forEach((value, index) => {
      if (value == null) {
        if (currentSegment.length) segments.push(currentSegment);
        currentSegment = [];
        return;
      }
      currentSegment.push(`${xFor(index)},${yFor(value)}`);
    });
    if (currentSegment.length) segments.push(currentSegment);
    return segments;
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className={`lineCard comparativeChart ${className}`}>
      <div className="lineLegend">
        <span><i className="dot current" />{currentLabel ?? currentYear ?? "CY"}</span>
        <span><i className="dot prior" />{priorLabel ?? (currentYear ? currentYear - 1 : "LY")}</span>
      </div>
      <svg viewBox="0 0 180 92" preserveAspectRatio="xMidYMid meet" role="img" aria-label={ariaLabel}>
        {ticks.map((tick) => {
          const y = 78 - tick * 66;
          return (
            <g key={`h-${tick}`}>
              <text className="axisLabel" x="8" y={y + 1}>{compactNumber(maxValue * tick)}</text>
              <line className="chartGridLine horizontal" x1="12" x2="176" y1={y} y2={y} />
            </g>
          );
        })}
        {months.map((month, index) => (
          <g key={month}>
            <line className="chartGridLine vertical" x1={xFor(index)} x2={xFor(index)} y1="12" y2="78" />
            <text className="monthLabel" x={xFor(index)} y="87">{month}</text>
          </g>
        ))}
        <line className="axisLine" x1="12" x2="176" y1="78" y2="78" />
        <line className="axisLine" x1="12" x2="12" y1="12" y2="78" />
        {lineSegments(displayedPrior).map((segment, index) => (
          <polyline key={`prior-line-${index}`} points={segment.join(" ")} className="priorLine" />
        ))}
        {lineSegments(displayedCurrent).map((segment, index) => (
          <polyline key={`current-line-${index}`} points={segment.join(" ")} className="currentLine" />
        ))}
        {displayedPrior.map((value, index) => (
          <g key={`prior-${index}`}>
            {value == null ? null : <circle className="priorPoint" cx={xFor(index)} cy={yFor(value)} r="1.15" />}
            {value ? (
              <text className="pointLabel priorLabel" x={xFor(index)} y={labelY(value, displayedCurrent[index] ?? 0, "prior")}>
                {compactNumber(value)}
              </text>
            ) : null}
          </g>
        ))}
        {displayedCurrent.map((value, index) => (
          <g key={`current-${index}`}>
            {value == null ? null : <circle className="currentPoint" cx={xFor(index)} cy={yFor(value)} r="1.15" />}
            {value ? (
              <text className="pointLabel currentLabel" x={xFor(index)} y={labelY(value, displayedPrior[index] ?? 0, "current")}>
                {compactNumber(value)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );

  function labelY(value: number, pairedValue: number, series: "current" | "prior") {
    const y = yFor(value);
    const pairedY = pairedValue ? yFor(pairedValue) : null;
    const isClose = pairedY != null && Math.abs(y - pairedY) < 6;
    if (!isClose) return y - 2.4;
    if (value !== pairedValue) return value > pairedValue ? y - 5.2 : y + 5.1;
    return series === "prior" ? y - 5.2 : y + 5.1;
  }
}

function padMonths(values: Array<number | null>) {
  return Array.from({ length: 12 }, (_, index) => (values[index] === null ? null : values[index] ?? 0));
}

function lastActiveMonthIndex(values: Array<number | null>) {
  for (let index = 11; index >= 0; index -= 1) {
    if ((values[index] ?? 0) > 0) return index;
  }
  return 0;
}

function compactNumber(value: number) {
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}K`;
  return numberText(Math.round(value));
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

async function fetchAllRecords(client: SupabaseClient, customerId: string) {
  const records: SalesRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("sales_records")
      .select("id,customer_id,transaction_date,amount,units,transaction_number,barcode,parent_sku,sku,product_class,master_style,color,size,catalog_color_name,style_number,raw_style_identifier,color_code,art_code,inventory_units,year_to_date_amount,year_to_date_units")
      .eq("customer_id", customerId)
      .order("transaction_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { records: [], error: error.message };
    records.push(...((data ?? []) as SalesRecord[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { records, error: "" };
}

async function fetchProductImages(client: SupabaseClient, customerId: string) {
  const { data } = await client
    .from("product_images")
    .select("style_number,art_code,color,product_url,image_url,storage_path")
    .eq("customer_id", customerId);
  return {
    images: ((data ?? []) as ProductImage[]).map((image) => ({
      ...image,
      resolved_url: image.image_url ?? storagePublicUrl(client, image.storage_path),
    })),
  };
}

async function fetchInventoryRecords(client: SupabaseClient, customerId: string) {
  const records: InventoryRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("inventory_records")
      .select("id,customer_id,upload_id,inventory_date,source_file,product_class,master_style,color,size,raw_style_identifier,style_number,catalog_color_name,art_code,inventory_units,current_retail")
      .eq("customer_id", customerId)
      .order("inventory_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { records: [], error: error.message };
    records.push(...((data ?? []) as InventoryRecord[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { records, error: "" };
}

function buildReportPayload({
  accountName,
  brandFilter,
  generatedAt,
  images,
  inventoryRecords,
  inventorySort = "highest",
  period,
  records,
  topArtSort = "units",
}: {
  accountName: string;
  brandFilter: string;
  generatedAt: string;
  images: ProductImage[];
  inventoryRecords: InventoryRecord[];
  inventorySort?: InventorySort;
  period: PeriodSelection;
  records: SalesRecord[];
  topArtSort?: TopArtSort;
}): ReportSnapshotPayload {
  const filteredRecords = records.filter((record) => brandFilter === "All" || brandName(record) === brandFilter);
  const filteredInventoryRecords = inventoryRecords.filter((record) => brandFilter === "All" || brandName(record) === brandFilter);
  const periodEndMonth = period.kind === "month" ? period.value : latestMonthForYear(filteredRecords, period.year);
  const priorYearMonth = periodEndMonth ? `${period.year - 1}${periodEndMonth.slice(4)}` : null;
  const periodRecords = recordsForSelectedPeriod(filteredRecords, period);
  const priorPeriodRecords = recordsForPriorPeriod(filteredRecords, period);
  const ytdCurrentRecords = currentYearRecords(filteredRecords, periodEndMonth);
  const ytdPriorRecords = priorYearMonth ? currentYearRecords(filteredRecords, priorYearMonth) : [];
  const priorYearRecords = recordsForYear(filteredRecords, period.year - 1);
  const currentMetrics = metricSet(periodRecords);
  const priorMetrics = metricSet(priorPeriodRecords);
  const selectedPeriodTitle = periodTitle(period, periodEndMonth);
  const priorPeriodTitle = priorTitle(period, periodEndMonth);
  const bestDay = bestSalesDay(periodRecords);
  const ytdStyleStudy = topStyleRows(ytdCurrentRecords, ytdPriorRecords);

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
    ytdLine: ytdPoints(filteredRecords, periodEndMonth),
    ytdInsights: ytdInsightMetrics(ytdCurrentRecords, ytdPriorRecords, periodEndMonth),
    monthlyDrivers: monthlyDriverMetrics(periodRecords, priorPeriodRecords),
    weeklyScorecards: period.kind === "month" ? weeklyScorecardRows(filteredRecords, periodEndMonth, images) : [],
    inventorySnapshot: inventorySnapshotForRecords(periodRecords, filteredInventoryRecords, periodEndMonth, filteredRecords),
    inventoryTrackerSort: inventorySort,
    inventoryTracker: inventoryTrackerRows(periodRecords, ytdCurrentRecords, priorYearRecords, filteredInventoryRecords, periodEndMonth, images, inventorySort, filteredRecords),
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

function periodTitle(period: PeriodSelection | null, endMonth: string | null) {
  if (!period) return "-";
  if (period.kind === "month") return monthText(period.value);
  return yearLabel(period.year, endMonth);
}

function priorTitle(period: PeriodSelection | null, endMonth: string | null) {
  if (!period) return "-";
  if (period.kind === "month") return monthText(`${period.year - 1}${period.value.slice(4)}`);
  return yearLabel(period.year - 1, endMonth ? `${period.year - 1}${endMonth.slice(4)}` : null);
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

function recordsForPriorPeriod(records: SalesRecord[], period: PeriodSelection) {
  if (period.kind === "month") return recordsForPeriod(records, `${period.year - 1}${period.value.slice(4)}`, "monthly");
  return recordsForYear(records, period.year - 1);
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
      const reportedYtd = reportedYtdTotals(group);
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
        cySales: reportedYtd?.sales ?? sum(cyGroup.map(amountValue)),
        cyUnits: reportedYtd?.units ?? sum(cyGroup.map((record) => record.units ?? 0)),
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

function reportedYtdTotals(records: SalesRecord[]) {
  const rowsWithYtd = records.filter((record) => record.year_to_date_units != null || record.year_to_date_amount != null);
  if (!rowsWithYtd.length) return null;

  return {
    sales: sum(rowsWithYtd.map((record) => Number(record.year_to_date_amount ?? 0))),
    units: sum(rowsWithYtd.map((record) => record.year_to_date_units ?? 0)),
  };
}

function storagePublicUrl(client: SupabaseClient, storagePath: string | null) {
  if (!storagePath) return null;
  return client.storage.from("product-images").getPublicUrl(storagePath).data.publicUrl;
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
  filteredInventoryTracker,
  images,
  inventoryTracker,
  records,
  topArt,
  visibleInventoryTracker,
  weeklyScorecards,
}: {
  bestDayItems: Array<{ style: string; artCode: string; color: string }>;
  filteredInventoryTracker: InventoryTrackerItem[];
  images: ProductImage[];
  inventoryTracker: InventoryTrackerItem[];
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
  filteredInventoryTracker.forEach((row) => addCandidate(row));
  inventoryTracker.forEach((row) => addCandidate(row));
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
      image_url: match.imageUrl,
      product_url: match.productUrl,
      storage_path: null,
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
  const priorGroups = groupBy(priorRecords, styleKey);
  return allStyleRows(records)
    .slice(0, 10)
    .map((style) => {
      const priorGroup = priorGroups.get(style.style) ?? [];
      return {
        ...style,
        priorUnits: sum(priorGroup.map((record) => record.units ?? 0)),
        priorSales: sum(priorGroup.map(amountValue)),
        priorColorCount: uniqueCount(priorGroup.map(colorName)),
        priorArtCount: uniqueCount(priorGroup.map((record) => clean(record.art_code))),
      };
    });
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

function bestSalesDay(records: SalesRecord[]) {
  const sortedDays = groupedRows(records, (record) => record.transaction_date).sort((left, right) => {
      const salesDelta = sum(right[1].map(amountValue)) - sum(left[1].map(amountValue));
      return salesDelta || sum(right[1].map((record) => record.units ?? 0)) - sum(left[1].map((record) => record.units ?? 0));
    });
  const best = sortedDays[0];
  const date = best?.[0] ?? null;
  const dayRecords = best?.[1] ?? [];

  const topItems = groupedRows(dayRecords, artKey)
    .map(([_key, group]) => ({
      rank: 0,
      style: normalizedStyle(group[0]),
      color: colorName(group[0]),
      artCode: clean(group[0].art_code) || "-",
      sales: sum(group.map(amountValue)),
      units: sum(group.map((record) => record.units ?? 0)),
      transactions: group.length,
    }))
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

function ytdPoints(records: SalesRecord[], month: string | null) {
  if (!month) return { current: [], prior: [], currentTotal: 0, priorTotal: 0 };
  const year = Number(month.slice(0, 4));
  const lastMonth = Number(month.slice(5, 7));
  const current: number[] = [];
  const prior: number[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const suffix = String(index).padStart(2, "0");
    current.push(index <= lastMonth ? sum(recordsForPeriod(records, `${year}-${suffix}`, "monthly").map(amountValue)) : 0);
    prior.push(sum(recordsForPeriod(records, `${year - 1}-${suffix}`, "monthly").map(amountValue)));
  }
  return {
    current,
    prior,
    currentTotal: sum(current),
    priorTotal: sum(prior.slice(0, lastMonth)),
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

function monthlyDriverMetrics(currentRecords: SalesRecord[], priorRecords: SalesRecord[]) {
  const current = metricSet(currentRecords);
  const prior = metricSet(priorRecords);
  const currentBreadth = breadthMetrics(currentRecords);
  const priorBreadth = breadthMetrics(priorRecords);
  const topFiveStyleSales = sum([...allStyleRows(currentRecords)].sort((left, right) => right.sales - left.sales).slice(0, 5).map((row) => row.sales));

  return {
    avgSalePerTransaction: current.transactions ? current.sales / current.transactions : 0,
    priorAvgSalePerTransaction: prior.transactions ? prior.sales / prior.transactions : 0,
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

function weeklyScorecardRows(records: SalesRecord[], month: string | null, images: ProductImage[]): WeeklyScorecardRow[] {
  if (!month) return [];
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

function inventoryProductMatches(row: InventoryTrackerItem, filter: InventoryProductFilter) {
  return filter === "All" || row.productCategory === filter;
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

function compactDateText(value: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getMonth() + 1}.${date.getDate()}.${String(date.getFullYear()).slice(-2)}`;
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

function changeText(current: number, prior: number) {
  if (!prior) return current ? "New" : "-";
  const percent = ((current - prior) / prior) * 100;
  return `${percent >= 0 ? "Up" : "Down"} ${Math.abs(percent).toFixed(1)}%`;
}

function signedCurrencyText(value: number) {
  if (!value) return currencyText(0);
  return `${value > 0 ? "+" : "-"}${currencyText(Math.abs(value))}`;
}

function signedNumberText(value: number) {
  if (!value) return numberText(0);
  return `${value > 0 ? "+" : "-"}${numberText(Math.abs(value))}`;
}

function changeClass(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function ytdTitle(month: string | null) {
  if (!month) return "Year to date";
  const date = new Date(`${month}-01T00:00:00`);
  const through = date.toLocaleDateString("en-US", { month: "long" });
  return `January through ${through}`;
}

function countText(value: number, singular: string, plural: string) {
  return `${numberText(value)} ${value === 1 ? singular : plural}`;
}

function inventoryPriorYearSoldText(value: number | null | undefined) {
  return value == null ? "NA" : `${numberText(value)} Units`;
}

function createReportToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `rpt_${Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("")}`;
}

async function loadExistingRecordKeys(
  client: SupabaseClient,
  customerId: string,
  startDate: string | null,
  endDate: string | null,
) {
  let query = client
    .from("sales_records")
    .select("transaction_date,amount,units,transaction_number,barcode,master_style,color,catalog_color_name,style_number,art_code,size,raw_style_identifier")
    .eq("customer_id", customerId);

  if (startDate) query = query.gte("transaction_date", startDate);
  if (endDate) query = query.lte("transaction_date", endDate);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return new Set(((data ?? []) as SalesRecordForDuplicateCheck[]).map(recordKey));
}

async function createUploadBatch(
  client: SupabaseClient,
  input: {
    customerId: string;
    fileName: string;
    userId: string;
    receivedDate: string | null;
    salesPeriodStart: string | null;
    salesPeriodEnd: string | null;
    rowCount: number;
    skippedCount: number;
    totalSales: number;
    totalUnits: number;
    status: "imported" | "duplicate";
  },
) {
  const { data, error } = await client
    .from("uploads")
    .insert({
      customer_id: input.customerId,
      source_file: input.fileName,
      original_file_name: input.fileName,
      imported_by: input.userId,
      received_date: input.receivedDate,
      sales_period_start: input.salesPeriodStart,
      sales_period_end: input.salesPeriodEnd,
      row_count: input.rowCount,
      skipped_count: input.skippedCount,
      total_sales: input.totalSales,
      total_units: input.totalUnits,
      status: input.status,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

async function insertSalesRecords(
  client: SupabaseClient,
  customerId: string,
  uploadId: string,
  records: ParsedSalesRecord[],
) {
  for (const chunk of chunks(records, 500)) {
    const { error } = await client.from("sales_records").insert(
      chunk.map((record) => ({
        ...record,
        customer_id: customerId,
        upload_id: uploadId,
      })),
    );

    if (error) throw new Error(error.message);
  }
}

async function replaceSalesRecordsForPeriodAndBrands(
  client: SupabaseClient,
  customerId: string,
  records: ParsedSalesRecord[],
  uploadId: string,
) {
  const dates = [...new Set(records.map((record) => record.transaction_date))].sort();
  const classes = [...new Set(records.map((record) => clean(record.product_class)).filter(Boolean))].sort();
  const startDate = dates[0];
  const endDate = dates.at(-1);
  if (!startDate || !endDate || classes.length === 0) {
    await insertSalesRecords(client, customerId, uploadId, records);
    return;
  }

  const classFilter = classes.map((productClass) => `product_class.ilike.${escapePostgrestPattern(productClass)}`).join(",");
  const { error } = await client
    .from("sales_records")
    .delete()
    .eq("customer_id", customerId)
    .gte("transaction_date", startDate)
    .lte("transaction_date", endDate)
    .or(classFilter);

  if (error) throw new Error(error.message);
  await insertSalesRecords(client, customerId, uploadId, records);
}

async function replaceInventoryRecordsForDates(
  client: SupabaseClient,
  customerId: string,
  inventoryDates: string[],
  records: ParsedInventoryRecord[],
  uploadId: string,
) {
  const productClasses = [...new Set(records.map((record) => clean(record.product_class)).filter(Boolean))];
  if (productClasses.length || inventoryDates.length) {
    let deleteQuery = client
      .from("inventory_records")
      .delete()
      .eq("customer_id", customerId);

    if (productClasses.length) {
      deleteQuery = deleteQuery.in("product_class", productClasses);
    } else {
      deleteQuery = deleteQuery.in("inventory_date", inventoryDates);
    }

    const { error } = await deleteQuery;
    if (error) throw new Error(error.message);
  }

  for (const chunk of chunks(records, 500)) {
    const { error } = await client.from("inventory_records").insert(
      chunk.map((record) => ({
        ...record,
        customer_id: customerId,
        upload_id: uploadId,
      })),
    );

    if (error) throw new Error(error.message);
  }
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

type SalesRecordForDuplicateCheck = Pick<
  SalesRecord,
  | "transaction_date"
  | "amount"
  | "units"
  | "transaction_number"
  | "barcode"
  | "master_style"
  | "color"
  | "catalog_color_name"
  | "style_number"
  | "art_code"
  | "size"
  | "raw_style_identifier"
>;

function recordKey(record: ParsedSalesRecord | SalesRecordForDuplicateCheck) {
  const transactionIdentity = compactKey(record.transaction_number) || compactKey(record.barcode);
  return [
    record.transaction_date,
    transactionIdentity,
    Number(record.amount ?? 0).toFixed(2),
    record.units ?? "",
    compactKey(record.style_number),
    compactKey(record.art_code),
    compactKey(record.catalog_color_name ?? record.color),
    compactKey(record.size),
    compactKey(record.master_style),
    compactKey(record.raw_style_identifier),
  ].join("|");
}

function compactKey(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function firstNonBlank(values: Array<string | null | undefined>) {
  return values.map(clean).find(Boolean) ?? null;
}

function escapePostgrestPattern(value: string) {
  return value.replace(/[,%]/g, (match) => `\\${match}`);
}
