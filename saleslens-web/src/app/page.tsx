"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { ParsedInventoryRecord, ParsedSalesRecord, SalesImportOptions } from "@/lib/importSalesData";
import {
  type DashboardData,
  type DashboardShellSummary,
  type InventoryRecord,
  type MerchandiseRecord,
  type ProductImage,
  type SalesRecord,
} from "@/lib/reportData";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { currencyText, dateText, decimalText, monthText, numberText, wholeCurrencyText } from "@/lib/formatters";
import type { ReportSnapshotBundlePayload, ReportSnapshotPayload } from "@/lib/reportSnapshot";
import type { Customer } from "@/lib/types";

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

type DashboardCacheEntry = {
  customerId: string;
  cachedAt: number;
  data: DashboardData;
};

type ServerReportState = {
  key: string;
  payload: ReportSnapshotPayload;
};

type UploadHistoryRow = {
  id: string;
  source_file: string;
  original_file_name: string;
  received_date: string | null;
  sales_period_start: string | null;
  sales_period_end: string | null;
  row_count: number;
  skipped_count: number;
  total_sales: number | string;
  total_units: number;
  status: string;
  created_at: string;
};

type DeleteUploadCandidate = {
  customerId: string;
  upload: UploadHistoryRow;
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type MetricSet = {
  sales: number;
  units: number;
  transactions: number;
  transactionsKnown?: boolean;
};

function ProductMedia({
  alt,
  className,
  height,
  sizes,
  src,
  width,
}: {
  alt: string;
  className?: string;
  height?: number;
  sizes: string;
  src: string;
  width?: number;
}) {
  if (width && height) {
    return (
      <Image
        alt={alt}
        className={className}
        height={height}
        loading="lazy"
        sizes={sizes}
        src={src}
        style={{ objectFit: "contain" }}
        width={width}
      />
    );
  }

  return (
    <Image
      alt={alt}
      className={className}
      fill
      loading="lazy"
      sizes={sizes}
      src={src}
      style={{ objectFit: "contain" }}
    />
  );
}

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
  priorYearUnits: number | null;
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
  ytdSales: number;
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
type InventoryProductFilter = "Fleece" | "Reverse Weave" | "Tees" | "Namedrop";
type TopArtSort = "units" | "dollars";
type ProductGalleryView = "top-sellers" | "inventory";
type ProductGallerySort = "units" | "dollars" | "inventory-high" | "inventory-low";
type ProductGalleryDisplayLimit = 25 | 50 | 100 | "all";
type ImportIntent = "sales" | "inventory";

type ProductGalleryItem = {
  rank: number;
  key: string;
  style: string;
  brand: string;
  color: string;
  artCode: string;
  monthUnits: number;
  monthSales: number;
  ytdUnits: number;
  ytdSales: number;
  priorYearUnits: number | null;
  inventoryUnits: number | null;
  imageUrl: string | null;
  productUrl: string | null;
};

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

const IMAGE_FETCH_BATCH_SIZE = 6;
const IMAGE_PREFETCH_LIMIT = 18;
const IMAGE_PREFETCH_RECORD_GROUP_LIMIT = 30;
const REPORT_CACHE_LIMIT = 16;
const DASHBOARD_CACHE_DB = "saleslens-dashboard-cache";
const DASHBOARD_CACHE_STORE = "dashboard-data";
const INVENTORY_TRACKER_MIN_UNITS = 5;
const INVENTORY_TRACKER_RECENT_DEMAND_UNITS = 25;
const INVENTORY_TRACKER_PAGE_SIZE = 50;
const PRODUCT_GALLERY_ALL_LIMIT = 10000;
const PRODUCT_GALLERY_DISPLAY_OPTIONS: ProductGalleryDisplayLimit[] = [25, 50, 100, "all"];
const INVENTORY_AUDIENCE_FILTERS: InventoryAudienceFilter[] = ["Mens", "Womens", "Youth"];
const INVENTORY_PRODUCT_FILTERS: InventoryProductFilter[] = ["Fleece", "Tees", "Reverse Weave", "Namedrop"];
const EMPTY_DASHBOARD_SHELL: DashboardShellSummary = {
  months: [],
  years: [],
  brandOptions: [],
  lastUploaded: null,
  lastUploadedByBrand: {},
  latestMonthByYear: {},
  latestMonthByBrandYear: {},
};
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
  "C6065",
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
  "CB1012",
  "CS1271",
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
  const [inventorySort, setInventorySort] = useState<InventorySort>("highest");
  const [, setInventoryPage] = useState(1);
  const [inventoryAudienceFilter, setInventoryAudienceFilter] = useState<InventoryAudienceFilter>("All");
  const [inventoryProductFilters, setInventoryProductFilters] = useState<InventoryProductFilter[]>([]);
  const [inventoryMenuOpen, setInventoryMenuOpen] = useState<"view" | "sort" | "refine" | null>(null);
  const [topArtSort, setTopArtSort] = useState<TopArtSort>("units");
  const [productGalleryView, setProductGalleryView] = useState<ProductGalleryView>("top-sellers");
  const [productGalleryDisplayLimit, setProductGalleryDisplayLimit] = useState<ProductGalleryDisplayLimit>(50);
  const [dashboardShell, setDashboardShell] = useState<DashboardShellSummary>(EMPTY_DASHBOARD_SHELL);
  const [dashboardData, setDashboardData] = useState<DashboardData>({ records: [], inventoryRecords: [], images: [] });
  const [serverReport, setServerReport] = useState<ServerReportState | null>(null);
  const [serverReportStatus, setServerReportStatus] = useState("");
  const [reportRefreshKey, setReportRefreshKey] = useState(0);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [pendingImportFiles, setPendingImportFiles] = useState<File[]>([]);
  const [importIntent, setImportIntent] = useState<ImportIntent | null>(null);
  const [importRangeStart, setImportRangeStart] = useState("");
  const [importRangeEnd, setImportRangeEnd] = useState("");
  const [dashboardStatus, setDashboardStatus] = useState("");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [selectedShareCustomerIds, setSelectedShareCustomerIds] = useState<string[]>([]);
  const [shareStatus, setShareStatus] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const inventoryControlsRef = useRef<HTMLDivElement | null>(null);
  const [importStatus, setImportStatus] = useState("");
  const [uploadHistoryOpen, setUploadHistoryOpen] = useState(false);
  const [uploadHistoryCustomerId, setUploadHistoryCustomerId] = useState("");
  const [uploadHistoryRows, setUploadHistoryRows] = useState<UploadHistoryRow[]>([]);
  const [uploadHistoryLoading, setUploadHistoryLoading] = useState(false);
  const [uploadHistoryStatus, setUploadHistoryStatus] = useState("");
  const [editingUploadId, setEditingUploadId] = useState<string | null>(null);
  const [editUploadRangeStart, setEditUploadRangeStart] = useState("");
  const [editUploadRangeEnd, setEditUploadRangeEnd] = useState("");
  const [deleteUploadCandidate, setDeleteUploadCandidate] = useState<DeleteUploadCandidate | null>(null);
  const [imageCacheRunning, setImageCacheRunning] = useState(false);
  const [imageCacheStatus, setImageCacheStatus] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [imagePrefetchRun, setImagePrefetchRun] = useState(0);
  const imageFetchAttempts = useRef<Set<string>>(new Set());
  const reportCache = useRef<Map<string, ReportSnapshotPayload>>(new Map());
  const uploadImportButtonRef = useRef<HTMLButtonElement | null>(null);
  const importReviewConfirmRef = useRef<HTMLButtonElement | null>(null);
  const uploadManagerCloseRef = useRef<HTMLButtonElement | null>(null);
  const deleteConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const shareModalCloseRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.removeItem("saleslens-theme");
  }, []);

  useEffect(() => {
    imageFetchAttempts.current.clear();
    setImagePrefetchRun(0);
    reportCache.current.clear();
  }, [reloadKey, selectedCustomerId]);

  useEffect(() => {
    setUploadHistoryOpen(false);
    setUploadHistoryRows([]);
    setUploadHistoryStatus("");
    setEditingUploadId(null);
    setEditUploadRangeStart("");
    setEditUploadRangeEnd("");
    setDeleteUploadCandidate(null);
    setImageCacheStatus("");
  }, [selectedCustomerId]);

  useEffect(() => {
    if (!importModalOpen) return;
    const timeout = window.setTimeout(() => {
      if (importIntent) {
        importReviewConfirmRef.current?.focus();
      } else {
        uploadImportButtonRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [importIntent, importModalOpen]);

  useEffect(() => {
    if (!uploadHistoryOpen) return;
    const timeout = window.setTimeout(() => {
      if (deleteUploadCandidate) {
        deleteConfirmButtonRef.current?.focus();
      } else {
        uploadManagerCloseRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [deleteUploadCandidate, uploadHistoryOpen]);

  useEffect(() => {
    if (!shareModalOpen) return;
    const timeout = window.setTimeout(() => {
      shareModalCloseRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [shareModalOpen]);

  useEffect(() => {
    function activeModalElement() {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'));
      return dialogs[dialogs.length - 1] ?? null;
    }

    function focusableElements(container: HTMLElement) {
      return Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden") && element.offsetParent !== null);
    }

    function handleModalKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const modal = activeModalElement();
        if (!modal) return;

        const focusable = focusableElements(modal);
        if (!focusable.length) {
          event.preventDefault();
          modal.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (!modal.contains(active)) {
          event.preventDefault();
          first.focus();
          return;
        }

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
          return;
        }

        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (event.key !== "Escape") return;
      if (deleteUploadCandidate) {
        event.preventDefault();
        setDeleteUploadCandidate(null);
        return;
      }
      if (importModalOpen) {
        event.preventDefault();
        if (importIntent) {
          setImportIntent(null);
        } else {
          closeImportModal();
        }
        return;
      }
      if (uploadHistoryOpen) {
        event.preventDefault();
        closeUploadHistoryManager();
        return;
      }
      if (shareModalOpen) {
        event.preventDefault();
        setShareModalOpen(false);
        setShareStatus("");
        setShareUrl("");
      }
    }

    if (!importModalOpen && !uploadHistoryOpen && !deleteUploadCandidate && !shareModalOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleModalKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", handleModalKeyDown);
    };
  }, [deleteUploadCandidate, importIntent, importModalOpen, shareModalOpen, uploadHistoryOpen]);

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
      setDashboardShell(EMPTY_DASHBOARD_SHELL);
      setDashboardData({ records: [], inventoryRecords: [], images: [] });
      setServerReport(null);
      setServerReportStatus("");
      return;
    }

    const client = supabase;
    const customerId = selectedCustomerId;
    let isMounted = true;
    setServerReport(null);
    setServerReportStatus("");
    setDashboardShell(EMPTY_DASHBOARD_SHELL);
    setDashboardData({ records: [], inventoryRecords: [], images: [] });
    setDashboardStatus("Loading dashboard...");

    async function loadDashboard() {
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        if (isMounted) setDashboardStatus("Sign in again to load dashboard controls.");
        return;
      }

      const response = await fetch("/api/dashboard-shell", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ customerId }),
      });
      const payload = (await response.json().catch(() => null)) as { shell?: DashboardShellSummary; error?: string } | null;
      if (!isMounted) return;

      if (!response.ok || !payload?.shell) {
        setDashboardStatus(payload?.error ?? "Unable to load dashboard controls.");
        setDashboardShell(EMPTY_DASHBOARD_SHELL);
        setDashboardData({ records: [], inventoryRecords: [], images: [] });
        return;
      }

      const shell = payload.shell;
      setDashboardShell(shell);
      setSelectedPeriod((current) => current ?? defaultPeriodValueFromMonths(shell.months));
      setDashboardStatus("");
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [supabase, selectedCustomerId, reloadKey]);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const months = dashboardShell.months;
  const years = dashboardShell.years;
  const periodOptions = useMemo(() => periodOptionGroups(months, years), [months, years]);
  const selectedPeriodValue = selectedPeriod ?? defaultPeriodValueFromMonths(dashboardShell.months);
  const period = useMemo(() => (selectedPeriodValue ? parsePeriodValue(selectedPeriodValue) : null), [selectedPeriodValue]);

  const recordsForCustomer = useMemo(() => {
    return dashboardData.records.filter((record) => brandFilter === "All" || brandName(record) === brandFilter);
  }, [brandFilter, dashboardData.records]);

  const periodEndMonth = useMemo(() => {
    if (!period) return null;
    if (period.kind === "month") return period.value;
    return latestMonthForShellYear(dashboardShell, brandFilter, period.year);
  }, [brandFilter, dashboardShell, period]);
  const productGalleryDisplayCount = productGalleryDisplayLimit === "all" ? PRODUCT_GALLERY_ALL_LIMIT : productGalleryDisplayLimit;
  const selectedYear = period?.year ?? null;
  const priorYearMonth = periodEndMonth && selectedYear ? `${selectedYear - 1}${periodEndMonth.slice(4)}` : null;
  const selectedPeriodKind = period?.kind ?? "month";
  const reportRequestKey = useMemo(() => {
    if (!selectedCustomerId || !period) return "";
    return JSON.stringify({
      brandFilter,
      customerId: selectedCustomerId,
      inventoryAudienceFilter,
      inventoryPage: 1,
      inventoryPageSize: productGalleryDisplayCount,
      inventoryProductFilters,
      inventorySort,
      period,
      reloadKey,
      reportRefreshKey,
      topArtSort,
    });
  }, [brandFilter, inventoryAudienceFilter, inventoryProductFilters, inventorySort, period, productGalleryDisplayCount, reloadKey, reportRefreshKey, selectedCustomerId, topArtSort]);
  const reportPayload =
    serverReport && selectedCustomer && serverReport.payload.accountName === selectedCustomer.name
      ? serverReport.payload
      : null;
  const isReportUpdating = Boolean(reportPayload && serverReport && serverReport.key !== reportRequestKey);
  const dashboardStatusLower = dashboardStatus.toLowerCase();
  const isDashboardPreparing = Boolean(dashboardStatus && dashboardStatusLower.includes("loading"));
  const isDashboardBlocked = Boolean(dashboardStatus && !isDashboardPreparing);
  const serverReportStatusLower = serverReportStatus.toLowerCase();
  const isReportPreparing = Boolean(!dashboardStatus && reportRequestKey && serverReportStatus && !reportPayload && (serverReportStatusLower.includes("preparing") || serverReportStatusLower.includes("updating")));
  const isReportBlocked = Boolean(!dashboardStatus && reportRequestKey && serverReportStatus && !reportPayload && !isReportPreparing);
  const isTotalsPreparing = isDashboardPreparing || isReportPreparing;
  const isTotalsBlocked = isDashboardBlocked || isReportBlocked;

  useEffect(() => {
    if (!supabase || !user || !selectedCustomerId || !period || !reportRequestKey) {
      setServerReport(null);
      setServerReportStatus("");
      return undefined;
    }

    let isMounted = true;
    const client = supabase;

    const cachedReport = reportCache.current.get(reportRequestKey);
    if (cachedReport) {
      setServerReport({ key: reportRequestKey, payload: cachedReport });
      setServerReportStatus("");
      return undefined;
    }

    setServerReportStatus("Preparing report sections...");

    async function loadServerReport() {
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        if (isMounted) setServerReportStatus("Sign in again to prepare report sections.");
        return;
      }

      const response = await fetch("/api/report-payload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          brandFilter,
          customerId: selectedCustomerId,
          inventoryAudienceFilter,
          inventoryPage: 1,
          inventoryPageSize: productGalleryDisplayCount,
          inventoryProductFilters,
          inventorySort,
          period,
          topArtSort,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { report?: ReportSnapshotPayload; error?: string } | null;

      if (!isMounted) return;
      if (!response.ok || !payload?.report) {
        setServerReport(null);
        setServerReportStatus(payload?.error ?? "Unable to prepare report sections.");
        return;
      }

      rememberReportPayload(reportCache.current, reportRequestKey, payload.report);
      setServerReport({ key: reportRequestKey, payload: payload.report });
      setServerReportStatus("");
      setImageCacheStatus((status) => status.includes("Rebuilding report view") ? "Report view updated with cached images." : status);
    }

    loadServerReport().catch(() => {
      if (isMounted) {
        setServerReport(null);
        setServerReportStatus("Unable to prepare report sections.");
      }
    });

    return () => {
      isMounted = false;
    };
  }, [brandFilter, inventoryAudienceFilter, inventoryProductFilters, inventorySort, period, productGalleryDisplayCount, reportRequestKey, selectedCustomerId, supabase, topArtSort, user]);

  const periodRecords = useMemo(() => {
    if (!period) return [];
    return recordsForSelectedPeriod(recordsForCustomer, period);
  }, [period, recordsForCustomer]);

  const priorPeriodRecords = useMemo(() => {
    if (!period) return [];
    return recordsForPriorPeriod(recordsForCustomer, period, periodRecords);
  }, [period, periodRecords, recordsForCustomer]);
  const selectedPeriodTitle = reportPayload?.periodTitle ?? periodTitle(period, periodEndMonth, periodRecords);
  const priorPeriodTitle = reportPayload?.priorPeriodTitle ?? priorTitle(period, periodEndMonth, periodRecords, recordsForCustomer);
  const topArtPeriodTitle = reportPayload?.topArtPeriodTitle ?? topPerformingRangeTitle(period, periodEndMonth, periodRecords);

  const currentMetrics = useMemo(
    () => (reportPayload?.currentMetrics as MetricSet | undefined) ?? metricSet(periodRecords),
    [periodRecords, reportPayload],
  );
  const priorMetrics = useMemo(
    () => (reportPayload?.priorMetrics as MetricSet | undefined) ?? metricSet(priorPeriodRecords),
    [priorPeriodRecords, reportPayload],
  );
  const monthlyDrivers = useMemo(
    () => (reportPayload?.monthlyDrivers as ReturnType<typeof monthlyDriverMetrics> | undefined) ?? monthlyDriverMetrics(periodRecords, priorPeriodRecords),
    [periodRecords, priorPeriodRecords, reportPayload],
  );
  const weeklyScorecards = useMemo(
    () => (reportPayload?.weeklyScorecards ?? []) as WeeklyScorecardRow[],
    [reportPayload],
  );
  const ytdCurrentRecords = useMemo(
    () => (period?.kind === "month" ? currentYtdRecordsForPeriod(recordsForCustomer, periodEndMonth, periodRecords) : currentYearRecords(recordsForCustomer, periodEndMonth)),
    [period, periodRecords, recordsForCustomer, periodEndMonth],
  );
  const ytdPriorRecords = useMemo(
    () =>
      period?.kind === "month"
        ? priorYtdRecordsForPeriod(recordsForCustomer, periodEndMonth, periodRecords)
        : priorYearMonth
          ? currentYearRecords(recordsForCustomer, priorYearMonth)
          : [],
    [period, periodEndMonth, periodRecords, priorYearMonth, recordsForCustomer],
  );
  const priorYearRecords = useMemo(
    () => (selectedYear ? recordsForYear(recordsForCustomer, selectedYear - 1) : []),
    [recordsForCustomer, selectedYear],
  );
  const ytdInsights = useMemo(
    () => (reportPayload?.ytdInsights as ReturnType<typeof ytdInsightMetrics> | undefined) ?? ytdInsightMetrics(ytdCurrentRecords, ytdPriorRecords, periodEndMonth),
    [periodEndMonth, reportPayload, ytdCurrentRecords, ytdPriorRecords],
  );
  const topArt = useMemo(
    () => (reportPayload?.topArt ?? []) as TopArt[],
    [reportPayload],
  );
  const inventorySnapshot = useMemo(
    () => (reportPayload?.inventorySnapshot ?? null) as InventorySnapshot,
    [reportPayload],
  );
  const inventoryTracker = useMemo(
    () => (reportPayload?.inventoryTracker ?? []) as InventoryTrackerItem[],
    [reportPayload],
  );
  const inventoryTrackerMeta = reportPayload?.inventoryTrackerMeta ?? null;
  const isConfirmedEmptyReport = Boolean(!dashboardStatus && !serverReportStatus && reportPayload && currentMetrics.sales === 0 && currentMetrics.units === 0);
  const visibleInventoryTracker = inventoryTracker;
  const inventoryPageStart = inventoryTrackerMeta?.pageStart ?? 0;
  const inventoryPageEnd = inventoryTrackerMeta?.pageEnd ?? 0;
  const inventoryTrackerTotalItems = inventoryTrackerMeta?.totalItems ?? inventoryTracker.length;
  const inventoryTrackerTotalUnits = inventoryTrackerMeta?.totalUnits ?? sum(inventoryTracker.map((row) => row.inventoryUnits));
  const productGalleryUsesInventory = productGalleryView === "inventory";
  const topSellerAllRows = useMemo<ProductGalleryItem[]>(() => {
    const sourceRows =
      periodRecords.length
        ? topArtRows(periodRecords, ytdCurrentRecords, dashboardData.images, dashboardData.inventoryRecords, topArtSort, priorYearRecords, null)
        : topArt;

    return sourceRows.map((row) => ({
      rank: row.rank,
      key: row.key,
      style: row.style,
      brand: row.brand,
      color: row.color,
      artCode: row.artCode,
      monthUnits: row.units,
      monthSales: row.sales,
      ytdUnits: row.cyUnits,
      ytdSales: row.cySales,
      priorYearUnits: row.priorYearUnits ?? null,
      inventoryUnits: row.inventoryUnits,
      imageUrl: row.imageUrl,
      productUrl: row.productUrl,
    }));
  }, [dashboardData.images, dashboardData.inventoryRecords, periodRecords, priorYearRecords, topArt, topArtSort, ytdCurrentRecords]);
  const topSellerPageStart = topSellerAllRows.length ? 1 : 0;
  const topSellerPageEnd = Math.min(productGalleryDisplayCount, topSellerAllRows.length);
  const topSellerGalleryRows = useMemo(
    () => topSellerAllRows.slice(0, productGalleryDisplayCount),
    [productGalleryDisplayCount, topSellerAllRows],
  );
  const topSellerLookup = useMemo(
    () => new Map(topSellerAllRows.map((row) => [row.key, row])),
    [topSellerAllRows],
  );
  const inventoryGalleryRows = useMemo<ProductGalleryItem[]>(
    () =>
      visibleInventoryTracker.map((row) => {
        const salesRow = topSellerLookup.get(row.key);
        return {
          rank: row.rank,
          key: row.key,
          style: row.style,
          brand: row.brand,
          color: row.color,
          artCode: row.artCode,
          monthUnits: salesRow?.monthUnits ?? 0,
          monthSales: salesRow?.monthSales ?? 0,
          ytdUnits: row.ytdUnits,
          ytdSales: row.ytdSales ?? salesRow?.ytdSales ?? 0,
          priorYearUnits: row.priorYearUnits,
          inventoryUnits: row.inventoryUnits,
          imageUrl: row.imageUrl ?? salesRow?.imageUrl ?? null,
          productUrl: row.productUrl ?? salesRow?.productUrl ?? null,
        };
      }),
    [topSellerLookup, visibleInventoryTracker],
  );
  const productGalleryRows = productGalleryUsesInventory ? inventoryGalleryRows : topSellerGalleryRows;
  const productGallerySourceRows = productGalleryUsesInventory ? inventoryGalleryRows : topSellerAllRows;
  const productGalleryPageStart = productGalleryUsesInventory ? inventoryPageStart : topSellerPageStart;
  const productGalleryPageEnd = productGalleryUsesInventory ? inventoryPageEnd : topSellerPageEnd;
  const productGalleryTotalItems = productGalleryUsesInventory ? inventoryTrackerTotalItems : topSellerAllRows.length;
  const productGalleryVisibleUnits = sum(productGalleryRows.map((row) => (productGalleryUsesInventory ? row.inventoryUnits ?? 0 : row.monthUnits)));
  const productGalleryVisibleSales = productGalleryUsesInventory
    ? sum(productGalleryRows.map((row) => row.ytdSales))
    : sum(productGalleryRows.map((row) => row.monthSales));
  const productGallerySortLabel = productGalleryUsesInventory
    ? inventorySort === "highest"
      ? "Inventory High"
      : "Inventory Low"
    : topArtSort === "units"
      ? "Units"
      : "Dollars";
  const productGalleryRefineLabel = [
    inventoryFilterSummary(inventoryAudienceFilter, inventoryProductFilters),
    productGalleryDisplayLimitLabel(productGalleryDisplayLimit),
  ].join(" | ");
  const productGalleryActiveRefinements = [
    inventoryAudienceFilter === "All" ? null : inventoryAudienceFilterLabel(inventoryAudienceFilter),
    ...inventoryProductFilters,
  ].filter(Boolean) as string[];
  const ytdLine = useMemo(
    () => reportPayload?.ytdLine ?? ytdPoints(recordsForCustomer, periodEndMonth, period?.kind === "month" ? periodRecords : []),
    [period, periodEndMonth, periodRecords, recordsForCustomer, reportPayload],
  );
  const ytdDelta = ytdLine.currentTotal - ytdLine.priorTotal;
  const ytdDecisionSummary =
    ytdLine.currentTotal || ytdLine.priorTotal
      ? `${changeText(ytdLine.currentTotal, ytdLine.priorTotal)} vs last year (${signedCurrencyText(ytdDelta)}). Breadth is ${numberText(ytdInsights.stylesSold)} styles, ${numberText(ytdInsights.colorsSold)} colors, and ${numberText(ytdInsights.artworksSold)} artworks.`
      : "No year-to-date sales are available for the current account and filters.";
  const monthlySalesDelta = currentMetrics.sales - priorMetrics.sales;
  const monthlyDecisionSummary =
    currentMetrics.sales || priorMetrics.sales
      ? `${selectedPeriodTitle} is ${changeText(currentMetrics.sales, priorMetrics.sales)} vs ${priorPeriodTitle} (${signedCurrencyText(monthlySalesDelta)}). Top 5 styles drove ${monthlyDrivers.topFiveStyleShare.toFixed(1)}% of sales.`
      : "No sales match the current period and filters.";
  const dashboardPeriodLabel = selectedPeriodTitle === "-" ? "Choose a period" : selectedPeriodTitle;
  const dashboardPriorLabel = priorPeriodTitle === "-" ? "Waiting for data" : priorPeriodTitle;
  const dashboardScoreTone = isTotalsPreparing || isTotalsBlocked ? "pending" : changeClass(monthlySalesDelta);
  const dashboardScoreChange =
    isTotalsPreparing ? "Preparing report" : isTotalsBlocked ? "Report unavailable" : currentMetrics.sales || priorMetrics.sales ? changeText(currentMetrics.sales, priorMetrics.sales) : "Confirmed zero";
  const dashboardScoreCurrency = isTotalsPreparing || isTotalsBlocked ? "" : currentMetrics.sales || priorMetrics.sales ? signedCurrencyText(monthlySalesDelta) : "";
  const dashboardCurrentSalesText = isTotalsPreparing ? "Loading" : isTotalsBlocked ? "-" : currencyText(currentMetrics.sales);
  const dashboardCurrentUnitsText = isTotalsPreparing ? "Loading" : isTotalsBlocked ? "-" : numberText(currentMetrics.units);
  const dashboardPriorUnitsText = isTotalsPreparing ? "Waiting for report" : isTotalsBlocked ? "No verified report" : `${numberText(priorMetrics.units)} LY`;
  const weeklyDecisionSummary = weeklyScorecards.length
    ? (() => {
        const bySales = [...weeklyScorecards].sort((left, right) => right.current.sales - left.current.sales);
        const bestWeek = bySales[0];
        const lightestWeek = bySales[bySales.length - 1];
        if (!bestWeek) return "";
        return bestWeek === lightestWeek
          ? `${bestWeek.title} totaled ${currencyText(bestWeek.current.sales)} across ${numberText(bestWeek.dayCount)} days.`
          : `${bestWeek.title} led at ${currencyText(bestWeek.current.sales)}; ${lightestWeek.title} was lightest at ${currencyText(lightestWeek.current.sales)}.`;
      })()
    : "";
  const inventoryDecisionSummary = inventorySnapshot
    ? `${inventorySnapshot.position.headline}. ${numberText(inventorySnapshot.totalUnits)} units across ${numberText(inventorySnapshot.styles)} styles and ${numberText(inventorySnapshot.artworks)} artworks.`
    : "";
  const productGalleryDecisionSummary = productGalleryTotalItems
    ? `${productGalleryViewLabel(productGalleryView)} shows ${numberText(productGalleryPageStart)}-${numberText(productGalleryPageEnd)} of ${numberText(productGalleryTotalItems)} items, sorted by ${productGallerySortLabel.toLowerCase()}. Visible rows total ${numberText(productGalleryVisibleUnits)} units and ${currencyText(productGalleryVisibleSales)}.`
    : "No product rows match the current filters.";
  const bestDay = useMemo(
    () => (reportPayload?.bestDay as ReturnType<typeof bestSalesDay> | undefined) ?? bestSalesDay(periodRecords, dashboardData.images),
    [dashboardData.images, periodRecords, reportPayload],
  );
  const imagePrefetchCandidates = useMemo(
    () => (reportPayload ? productImageCandidates({
      bestDayItems: bestDay.items,
      images: dashboardData.images,
      records: [],
      topArt,
      visibleInventoryTracker,
      weeklyScorecards,
    }) : []),
    [bestDay.items, dashboardData.images, reportPayload, topArt, visibleInventoryTracker, weeklyScorecards],
  );
  const missingImageCount = imagePrefetchCandidates.filter((row) => !row.imageUrl && row.style !== "-").length;
  const pendingImportSummary = useMemo(() => {
    const totalBytes = pendingImportFiles.reduce((total, file) => total + file.size, 0);
    return {
      fileCount: pendingImportFiles.length,
      totalBytes,
      fileLabels: pendingImportFiles.map((file) => `${file.name} (${fileSizeText(file.size)})`),
    };
  }, [pendingImportFiles]);
  const brandOptions = useMemo(() => ["All", ...dashboardShell.brandOptions], [dashboardShell.brandOptions]);

  useEffect(() => {
    setInventoryPage(1);
  }, [brandFilter, inventoryAudienceFilter, inventoryProductFilters, inventorySort, productGalleryDisplayLimit, selectedCustomerId, selectedPeriod]);

  useEffect(() => {
    if (!inventoryMenuOpen) return undefined;

    function handlePointerDown(event: PointerEvent) {
      if (inventoryControlsRef.current?.contains(event.target as Node)) return;
      setInventoryMenuOpen(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [inventoryMenuOpen]);

  function applyInventorySort(sort: InventorySort) {
    setInventorySort(sort);
    setInventoryPage(1);
    setInventoryMenuOpen(null);
  }

  function applyProductGalleryView(view: ProductGalleryView) {
    setProductGalleryView(view);
    setInventoryPage(1);
    if (view === "inventory") setInventorySort("highest");
    setInventoryMenuOpen(null);
  }

  function applyProductGallerySort(sort: ProductGallerySort) {
    setInventoryPage(1);
    if (sort === "units" || sort === "dollars") {
      setTopArtSort(sort);
      setProductGalleryView("top-sellers");
    } else {
      setInventorySort(sort === "inventory-high" ? "highest" : "lowest");
      setProductGalleryView("inventory");
    }
    setInventoryMenuOpen(null);
  }

  function applyProductGalleryDisplayLimit(limit: ProductGalleryDisplayLimit) {
    setProductGalleryDisplayLimit(limit);
    setInventoryPage(1);
    setInventoryMenuOpen(null);
  }

  function clearInventoryFilters() {
    setInventoryAudienceFilter("All");
    setInventoryProductFilters([]);
    setProductGalleryDisplayLimit(50);
    setInventoryPage(1);
    setInventoryMenuOpen(null);
  }

  function applyInventoryAudienceFilter(filter: InventoryAudienceFilter) {
    setInventoryAudienceFilter(filter);
    setInventoryPage(1);
    if (inventoryProductFilters.includes("Namedrop") && filter !== "All" && filter !== "Mens") {
      setInventoryProductFilters([]);
    }
  }

  function toggleInventoryProductFilter(filter: InventoryProductFilter) {
    setInventoryPage(1);

    if (filter === "Namedrop") {
      setInventoryAudienceFilter("All");
      setInventoryProductFilters((current) => (current.includes("Namedrop") ? [] : ["Namedrop"]));
      setInventoryMenuOpen(null);
      return;
    }

    setInventoryProductFilters((current) => {
      const withoutNamedrop = current.filter((item) => item !== "Namedrop");
      return withoutNamedrop.includes(filter)
        ? withoutNamedrop.filter((item) => item !== filter)
        : [...withoutNamedrop, filter];
    });
  }

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
        image_url: match.sourceImageUrl ?? match.imageUrl,
        storage_path: match.storagePath ?? null,
        is_manual_override: match.isManualOverride,
        notes: `Matched from product website using ${match.lookupArtCode}`,
      }));

      const { error } = await client
        .from("product_images")
        .upsert(rows, { onConflict: "customer_id,style_number,art_code,color" });

      if (error || isCancelled) return;

      setDashboardData((current) => {
        const next = {
          ...current,
          images: mergeProductImages(current.images, matches),
        };
        writeDashboardCache(customerId, next).catch(() => undefined);
        return next;
      });
      setReportRefreshKey((key) => key + 1);
    }

    const cancelFetch = scheduleDashboardIdle(() => {
      fetchMissingImages().catch(() => undefined);
    });

    return () => {
      isCancelled = true;
      cancelFetch();
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
    const { data } = await client.auth.getSession();
    const sessionToken = data.session?.access_token;
    if (!sessionToken) {
      setShareStatus("Sign in again to generate a share link.");
      return;
    }

    async function reportForCustomer(customer: Customer) {
      const response = await fetch("/api/report-payload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          brandFilter,
          customerId: customer.id,
          inventoryAudienceFilter,
          inventoryPage: 1,
          inventoryPageSize: productGalleryDisplayCount,
          inventoryProductFilters,
          inventorySort,
          period: activePeriod,
          topArtSort,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { report?: ReportSnapshotPayload; error?: string } | null;

      if (!response.ok || !payload?.report) {
        throw new Error(payload?.error ?? `Unable to build ${customer.name} report.`);
      }

      return { ...payload.report, generatedAt };
    }

    let reports: ReportSnapshotPayload[];
    try {
      reports = await Promise.all(shareCustomers.map(reportForCustomer));
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "Unable to generate share link.");
      return;
    }
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

  function openUploadHistoryManager() {
    const customerId = selectedCustomerId || uploadHistoryCustomerId || customers[0]?.id || "";
    setUploadHistoryCustomerId(customerId);
    setUploadHistoryOpen(true);
    if (customerId) void loadUploadHistory(customerId);
  }

  function closeUploadHistoryManager() {
    setUploadHistoryOpen(false);
    setDeleteUploadCandidate(null);
    setEditingUploadId(null);
    setEditUploadRangeStart("");
    setEditUploadRangeEnd("");
  }

  function beginEditUpload(upload: UploadHistoryRow) {
    setEditingUploadId(upload.id);
    setEditUploadRangeStart(dateInputValue(upload.sales_period_start));
    setEditUploadRangeEnd(dateInputValue(upload.sales_period_end));
  }

  function cancelEditUpload() {
    setEditingUploadId(null);
    setEditUploadRangeStart("");
    setEditUploadRangeEnd("");
  }

  async function loadUploadHistory(customerId = uploadHistoryCustomerId || selectedCustomerId || "") {
    if (!supabase || !customerId) return;
    setUploadHistoryLoading(true);
    setUploadHistoryStatus("Loading upload history...");

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setUploadHistoryStatus("Sign in again to load upload history.");
        return;
      }

      const response = await fetch(`/api/upload-history?customerId=${encodeURIComponent(customerId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as { uploads?: UploadHistoryRow[]; error?: string } | null;
      if (!response.ok || !payload?.uploads) {
        setUploadHistoryStatus(payload?.error ?? "Unable to load upload history.");
        return;
      }

      setUploadHistoryRows(payload.uploads);
      setUploadHistoryStatus(payload.uploads.length ? "" : "No uploads found for this account.");
      cancelEditUpload();
    } finally {
      setUploadHistoryLoading(false);
    }
  }

  function requestDeleteUpload(upload: UploadHistoryRow) {
    const customerId = uploadHistoryCustomerId || selectedCustomerId;
    if (!supabase || !customerId) return;
    setDeleteUploadCandidate({ customerId, upload });
  }

  async function confirmDeleteUpload() {
    const candidate = deleteUploadCandidate;
    if (!candidate || !supabase) return;
    const { customerId, upload } = candidate;
    const label = upload.original_file_name || upload.source_file || "this upload";

    setUploadHistoryStatus(`Deleting ${label}...`);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setUploadHistoryStatus("Sign in again to delete uploads.");
      return;
    }

    const response = await fetch("/api/upload-history", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        customerId,
        uploadId: upload.id,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      deletedInventoryRecords?: number;
      deletedSalesRecords?: number;
      error?: string;
    } | null;

    if (!response.ok) {
      setUploadHistoryStatus(payload?.error ?? "Unable to delete upload.");
      return;
    }

    reportCache.current.clear();
    setReportRefreshKey((key) => key + 1);
    setReloadKey((key) => key + 1);
    setUploadHistoryRows((rows) => rows.filter((row) => row.id !== upload.id));
    setDeleteUploadCandidate(null);
    setUploadHistoryStatus(
      `Deleted ${label}: ${numberText(payload?.deletedSalesRecords ?? 0)} sales records and ${numberText(payload?.deletedInventoryRecords ?? 0)} inventory records.`,
    );
  }

  async function saveUploadDateRange(upload: UploadHistoryRow) {
    const customerId = uploadHistoryCustomerId || selectedCustomerId;
    if (!supabase || !customerId) return;
    if (!editUploadRangeStart || !editUploadRangeEnd) {
      setUploadHistoryStatus("Choose both a start and end date before saving.");
      return;
    }
    if (editUploadRangeStart > editUploadRangeEnd) {
      setUploadHistoryStatus("The upload start date must be before the end date.");
      return;
    }

    const label = upload.original_file_name || upload.source_file || "this upload";
    setUploadHistoryStatus(`Updating ${label}...`);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setUploadHistoryStatus("Sign in again to edit uploads.");
      return;
    }

    const response = await fetch("/api/upload-history", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        customerId,
        uploadId: upload.id,
        salesPeriodStart: editUploadRangeStart,
        salesPeriodEnd: editUploadRangeEnd,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      upload?: UploadHistoryRow;
      error?: string;
    } | null;

    if (!response.ok || !payload?.upload) {
      setUploadHistoryStatus(payload?.error ?? "Unable to update upload.");
      return;
    }

    setUploadHistoryRows((rows) => rows.map((row) => (row.id === upload.id ? payload.upload! : row)));
    cancelEditUpload();
    reportCache.current.clear();
    setReportRefreshKey((key) => key + 1);
    setReloadKey((key) => key + 1);
    setUploadHistoryStatus(`Updated date range for ${label}.`);
  }

  async function cacheMissingImages() {
    if (!supabase || !selectedCustomerId || !selectedCustomer || !supportsProductImageFetch(selectedCustomer.name)) return;
    const missingRows = imagePrefetchCandidates
      .filter((row) => !row.imageUrl && row.style !== "-")
      .slice(0, 120);

    if (!missingRows.length) {
      setImageCacheStatus("No missing images in the current view.");
      return;
    }

    setImageCacheRunning(true);
    setImageCacheStatus(`Searching ${numberText(missingRows.length)} missing images...`);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setImageCacheStatus("Sign in again to cache product images.");
        return;
      }

      const allMatches: RebelRagsImageMatch[] = [];
      for (let index = 0; index < missingRows.length; index += IMAGE_FETCH_BATCH_SIZE) {
        const batch = missingRows.slice(index, index + IMAGE_FETCH_BATCH_SIZE);
        const response = await fetch("/api/rebel-rags-image", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            accountName: selectedCustomer.name,
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
        const payload = (await response.json().catch(() => null)) as { matches?: RebelRagsImageMatch[] } | null;
        allMatches.push(...(payload?.matches?.filter((match) => match.imageUrl) ?? []));
      }

      const matchesByKey = new Map<string, RebelRagsImageMatch>();
      allMatches.forEach((match) => matchesByKey.set(imageKey(match.style, match.artCode, match.color), match));
      const matches = [...matchesByKey.values()];

      if (!matches.length) {
        setImageCacheStatus("No new image matches found in this view.");
        return;
      }

      const rows = matches.map((match) => ({
        customer_id: selectedCustomerId,
        style_number: match.style,
        art_code: match.artCode,
        color: match.color,
        product_url: match.productUrl,
        image_url: match.sourceImageUrl ?? match.imageUrl,
        storage_path: match.storagePath ?? null,
        is_manual_override: match.isManualOverride,
        notes: `Matched from product website using ${match.lookupArtCode}`,
      }));

      const { error } = await supabase
        .from("product_images")
        .upsert(rows, { onConflict: "customer_id,style_number,art_code,color" });

      if (error) {
        setImageCacheStatus(error.message);
        return;
      }

      setDashboardData((current) => {
        const next = {
          ...current,
          images: mergeProductImages(current.images, matches),
        };
        writeDashboardCache(selectedCustomerId, next).catch(() => undefined);
        return next;
      });
      reportCache.current.clear();
      setReportRefreshKey((key) => key + 1);
      setImagePrefetchRun((run) => run + 1);
      setImageCacheStatus(`Cached ${numberText(matches.length)} product images. Rebuilding report view...`);
    } finally {
      setImageCacheRunning(false);
    }
  }

  function beginImportFiles(files: File[]) {
    if (files.length === 0 || !selectedCustomer) return;
    setImportIntent(null);
    setCustomerStatus("");
    setPendingImportFiles((current) => [...current, ...files]);
  }

  function closeImportModal() {
    setImportModalOpen(false);
    setPendingImportFiles([]);
    setImportIntent(null);
    setImportRangeStart("");
    setImportRangeEnd("");
    setCustomerStatus("");
  }

  function removePendingImportFile(indexToRemove: number) {
    setPendingImportFiles((files) => files.filter((_file, index) => index !== indexToRemove));
    setImportIntent(null);
  }

  function reviewImport(intent: ImportIntent) {
    if (!pendingImportFiles.length) {
      setCustomerStatus("Choose at least one file before reviewing an import.");
      return;
    }
    const range = selectedImportRange();
    if (!range) return;
    setCustomerStatus("");
    setImportIntent(intent);
  }

  function confirmReviewedImport() {
    if (!importIntent) return;
    const range = selectedImportRange();
    if (!range) return;
    const files = pendingImportFiles;
    const intent = importIntent;
    closeImportModal();
    if (intent === "sales") {
      void importSalesFiles(files, range);
    } else {
      void importInventoryFiles(files);
    }
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
      const { parseSalesWorkbook } = await import("@/lib/importSalesData");
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
        await replaceSalesRecordsForPeriodAndBrands(
          supabase,
          selectedCustomer.id,
          parsed.records,
          uploadId,
          parsed.salesPeriodStart,
          parsed.salesPeriodEnd,
        );

        setImportStatus(
          `Imported ${numberText(parsed.records.length)} records from ${file.name}. Replaced matching date and brand/class records for this upload range. Skipped ${numberText(parsed.skippedCount)} rows.`,
        );
        return true;
      }

      setImportStatus(`Calculating weekly Volshop sales from prior YTD snapshot...`);
      const adjusted = await applyVolshopCumulativeDeltas(
        supabase,
        selectedCustomer.id,
        parsed.records,
        parsed.salesPeriodStart,
      );
      const recordsToImport = adjusted.records;
      const totalSales = sum(recordsToImport.map((record) => record.amount));
      const totalUnits = sum(recordsToImport.map((record) => record.units ?? 0));
      const uploadId = await createUploadBatch(supabase, {
        customerId: selectedCustomer.id,
        fileName: file.name,
        userId: user.id,
        receivedDate: parsed.receivedDate,
        salesPeriodStart: parsed.salesPeriodStart,
        salesPeriodEnd: parsed.salesPeriodEnd,
        rowCount: recordsToImport.length,
        skippedCount: parsed.skippedCount,
        totalSales,
        totalUnits,
        status: "imported",
      });

      setImportStatus(`Replacing overlapping Volshop weekly snapshot records...`);
      await replaceSalesRecordsForPeriodAndBrands(
        supabase,
        selectedCustomer.id,
        recordsToImport,
        uploadId,
        parsed.salesPeriodStart,
        parsed.salesPeriodEnd,
      );

      const deltaNote = adjusted.deltaCount
        ? ` Calculated ${numberText(adjusted.deltaCount)} rows from YTD deltas.`
        : "";
      const fallbackNote = adjusted.fallbackCount
        ? ` ${numberText(adjusted.fallbackCount)} rows used sheet MTD because no prior YTD baseline was found.`
        : "";
      setImportStatus(
        `Imported ${numberText(recordsToImport.length)} records from ${file.name}. Replaced matching weekly snapshot records for this upload range.${deltaNote}${fallbackNote} Skipped ${numberText(parsed.skippedCount)} rows.`,
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
      const { parseInventoryWorkbook } = await import("@/lib/importSalesData");
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
        <nav className="topNav" aria-label="SalesLens controls">
          <div className="navBrand">
            <h1>SalesLens</h1>
            <p>by Lester Sales</p>
          </div>

          <div className="navControlIsland" aria-label="Report controls">
            <label className="navField">
              <select
                aria-label="Account"
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

            <label className="navField">
              <select
                aria-label="Period"
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
          </div>

          <div className="navActions">
            <div className="navUploadField">
              <button
                aria-label="Upload or import"
                className="fileButton"
                onClick={() => {
                  setCustomerStatus("");
                  setImportModalOpen(true);
                }}
                type="button"
              >
                Upload
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

            <button
              className="navShareButton"
              onClick={() => {
                setShareModalOpen(true);
                setSelectedShareCustomerIds(selectedCustomerId ? [selectedCustomerId] : []);
                setShareStatus("");
                setShareUrl("");
              }}
              disabled={!period}
              type="button"
            >
              Share
            </button>

            <button className="ghostButton navSignOut" type="button" onClick={signOut}>
              Sign Out
            </button>
          </div>
        </nav>

        {importModalOpen ? (
          <div className="modalOverlay" role="presentation">
            <section className="shareModal importTypeModal" role="dialog" aria-modal="true" aria-labelledby="import-type-title" tabIndex={-1}>
              <button
                aria-label="Close import type"
                className="modalCloseButton"
                onClick={closeImportModal}
                type="button"
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
                  onClick={() => reviewImport("sales")}
                  ref={uploadImportButtonRef}
                  type="button"
                >
                  <strong>Sales Data</strong>
                  <span>Review POS sales with units and dollars before replacing overlapping records.</span>
                </button>
                <button
                  disabled={pendingImportFiles.length === 0}
                  onClick={() => reviewImport("inventory")}
                  type="button"
                >
                  <strong>Inventory Report</strong>
                  <span>Review standalone on-hand units before replacing inventory for the file dates.</span>
                </button>
              </div>
              {importIntent ? (
                <div className="importReviewPanel" aria-live="polite">
                  <div className="importReviewHeader">
                    <span>Review before import</span>
                    <strong>{importIntent === "sales" ? "Sales Data" : "Inventory Report"}</strong>
                  </div>
                  <div className="importImpactGrid">
                    <div>
                      <span>Account</span>
                      <strong>{selectedCustomer?.name ?? "Selected account"}</strong>
                    </div>
                    <div>
                      <span>Files</span>
                      <strong>{numberText(pendingImportSummary.fileCount)} file{pendingImportSummary.fileCount === 1 ? "" : "s"} | {fileSizeText(pendingImportSummary.totalBytes)}</strong>
                    </div>
                    <div>
                      <span>{importIntent === "sales" ? "Sales Range" : "Inventory Dates"}</span>
                      <strong>
                        {importIntent === "sales"
                          ? importRangeStart || importRangeEnd
                            ? `${dateText(importRangeStart || null)} - ${dateText(importRangeEnd || null)}`
                            : "Use dates detected in each file"
                          : "Use dates detected in each file"}
                      </strong>
                    </div>
                  </div>
                  <div className="importImpactNotice">
                    <strong>{importIntent === "sales" ? "Replacement impact" : "Inventory impact"}</strong>
                    <p>
                      {importIntent === "sales"
                        ? "Sales import will create an upload record, then replace existing records for this account where the file date range and brand/class overlap."
                        : "Inventory import will create an upload record, then replace existing on-hand records for this account on the inventory dates found in the file."}
                    </p>
                  </div>
                  <ul className="importFileReviewList">
                    {pendingImportSummary.fileLabels.map((label, index) => (
                      <li key={`${label}-${index}`}>{label}</li>
                    ))}
                  </ul>
                  <div className="importReviewActions">
                    <button className="ghostButton" type="button" onClick={() => setImportIntent(null)}>
                      Back
                    </button>
                    <button
                      className="shareGenerateButton"
                      type="button"
                      ref={importReviewConfirmRef}
                      onClick={confirmReviewedImport}
                    >
                      Import {importIntent === "sales" ? "Sales Data" : "Inventory Report"}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="uploadHistoryActions">
                <button
                  className="ghostButton"
                  type="button"
                  onClick={openUploadHistoryManager}
                >
                  Manage Uploads
                </button>
                {uploadHistoryStatus ? <span>{uploadHistoryStatus}</span> : null}
              </div>
            </section>
          </div>
        ) : null}

        {uploadHistoryOpen ? (
          <div className="modalOverlay" role="presentation">
            <section className="shareModal uploadManagerModal" role="dialog" aria-modal="true" aria-labelledby="upload-manager-title" tabIndex={-1}>
              <button
                aria-label="Close upload manager"
                className="modalCloseButton"
                onClick={closeUploadHistoryManager}
                ref={uploadManagerCloseRef}
                type="button"
              >
                X
              </button>
              <p className="eyebrow">Upload Manager</p>
              <h3 id="upload-manager-title">Manage Uploads</h3>
              <div className="uploadManagerToolbar">
                <label>
                  <span>Account</span>
                  <select
                    value={uploadHistoryCustomerId}
                    onChange={(event) => {
                      const customerId = event.target.value;
                      setUploadHistoryCustomerId(customerId);
                      void loadUploadHistory(customerId);
                    }}
                  >
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="ghostButton" type="button" onClick={() => void loadUploadHistory()}>
                  Refresh
                </button>
              </div>
              {uploadHistoryStatus ? <p className="shareStatus">{uploadHistoryStatus}</p> : null}
              <div className="uploadHistoryPanel uploadManagerList" aria-live="polite">
                {uploadHistoryLoading ? <p>Loading uploads...</p> : null}
                {!uploadHistoryLoading && uploadHistoryRows.length ? (
                  uploadHistoryRows.map((upload) => {
                    const isEditing = editingUploadId === upload.id;
                    return (
                      <article className="uploadHistoryRow uploadManagerRow" key={upload.id}>
                        <div className="uploadManagerFile">
                          <strong>{upload.original_file_name || upload.source_file || "Imported upload"}</strong>
                          <span>Uploaded {uploadedAtText(upload.created_at)}</span>
                        </div>
                        <div className="uploadManagerRange">
                          {isEditing ? (
                            <>
                              <label>
                                <span>Start</span>
                                <input
                                  type="date"
                                  value={editUploadRangeStart}
                                  onChange={(event) => setEditUploadRangeStart(event.target.value)}
                                />
                              </label>
                              <label>
                                <span>End</span>
                                <input
                                  type="date"
                                  value={editUploadRangeEnd}
                                  onChange={(event) => setEditUploadRangeEnd(event.target.value)}
                                />
                              </label>
                            </>
                          ) : (
                            <>
                              <span>Range</span>
                              <strong>{dateText(upload.sales_period_start)} - {dateText(upload.sales_period_end)}</strong>
                            </>
                          )}
                        </div>
                        <div className="uploadManagerStats">
                          <span>{numberText(upload.row_count)} rows</span>
                          <span>{numberText(upload.total_units ?? 0)} units</span>
                          <span>{currencyText(Number(upload.total_sales ?? 0))}</span>
                        </div>
                        <div className="uploadManagerActions">
                          {isEditing ? (
                            <>
                              <button className="ghostButton compactButton" type="button" onClick={() => void saveUploadDateRange(upload)}>
                                Save
                              </button>
                              <button className="ghostButton compactButton" type="button" onClick={cancelEditUpload}>
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button className="ghostButton compactButton" type="button" onClick={() => beginEditUpload(upload)}>
                              Edit
                            </button>
                          )}
                          <button className="dangerTextButton" type="button" onClick={() => requestDeleteUpload(upload)}>
                            Delete
                          </button>
                        </div>
                      </article>
                    );
                  })
                ) : null}
                {!uploadHistoryLoading && !uploadHistoryRows.length ? (
                  <p className="muted">No uploads are currently listed for this account.</p>
                ) : null}
              </div>
              {deleteUploadCandidate ? (
                <div className="deleteConfirmPanel" role="alertdialog" aria-modal="true" aria-labelledby="delete-upload-title" tabIndex={-1}>
                  <div>
                    <p className="eyebrow">Destructive Action</p>
                    <h4 id="delete-upload-title">Delete this upload?</h4>
                    <p>
                      This removes the upload history row and every sales or inventory record imported from it. The dashboard will rebuild after deletion.
                    </p>
                  </div>
                  <div className="deleteImpactGrid">
                    <div>
                      <span>File</span>
                      <strong>{deleteUploadCandidate.upload.original_file_name || deleteUploadCandidate.upload.source_file || "Imported upload"}</strong>
                    </div>
                    <div>
                      <span>Range</span>
                      <strong>{dateText(deleteUploadCandidate.upload.sales_period_start)} - {dateText(deleteUploadCandidate.upload.sales_period_end)}</strong>
                    </div>
                    <div>
                      <span>Rows</span>
                      <strong>{numberText(deleteUploadCandidate.upload.row_count)}</strong>
                    </div>
                    <div>
                      <span>Units / Sales</span>
                      <strong>{numberText(deleteUploadCandidate.upload.total_units ?? 0)} | {currencyText(Number(deleteUploadCandidate.upload.total_sales ?? 0))}</strong>
                    </div>
                  </div>
                  <div className="deleteConfirmActions">
                    <button className="ghostButton" type="button" onClick={() => setDeleteUploadCandidate(null)}>
                      Keep Upload
                    </button>
                    <button
                      className="dangerActionButton"
                      type="button"
                      ref={deleteConfirmButtonRef}
                      onClick={() => void confirmDeleteUpload()}
                    >
                      Delete Upload
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        <section className="dashboard" id="saleslens-dashboard">
          <header className="dashboardHeader dashboardTopSection">
            <div className="dashboardHeroIntro">
              <div className="dashboardHeroKicker">
                <p className="eyebrow">Sales Snapshot</p>
                <span>{dashboardPeriodLabel}</span>
              </div>
              <h2>{selectedCustomer?.name ?? "Account"}</h2>
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
            </div>

            <div className={`dashboardScoreboard ${dashboardScoreTone}`} aria-label={`${dashboardPeriodLabel} sales snapshot`}>
              <div className="scoreboardPrimary">
                <span>{isTotalsPreparing ? "Preparing Sales" : isTotalsBlocked ? "Sales Unavailable" : "Current Sales"}</span>
                <strong>{dashboardCurrentSalesText}</strong>
                <em>{isTotalsPreparing ? "Report is loading" : isTotalsBlocked ? "No verified totals shown" : dashboardPeriodLabel}</em>
              </div>
              <div>
                <span>Vs Last Year</span>
                <strong className="scoreDeltaValue">
                  <span>{dashboardScoreChange}</span>
                  {dashboardScoreCurrency ? <span>{dashboardScoreCurrency}</span> : null}
                </strong>
                <em>{dashboardPriorLabel}</em>
              </div>
              <div>
                <span>Units</span>
                <strong>{dashboardCurrentUnitsText}</strong>
                <em>{dashboardPriorUnitsText}</em>
              </div>
            </div>

          </header>

          {shareModalOpen ? (
            <div className="modalOverlay" role="presentation">
              <section className="shareModal" role="dialog" aria-modal="true" aria-labelledby="share-report-title" tabIndex={-1}>
                <button
                  aria-label="Close share report"
                  className="modalCloseButton"
                  onClick={() => {
                    setShareModalOpen(false);
                    setShareStatus("");
                    setShareUrl("");
                  }}
                  ref={shareModalCloseRef}
                  type="button"
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

                <button className="shareGenerateButton" type="button" onClick={() => createShareLink()} disabled={!selectedShareCustomerIds.length || shareStatus.includes("Generating")}>
                  Generate {selectedShareCustomerIds.length > 1 ? "Multi-Account" : "Account"} Link
                </button>

                {shareStatus ? <p className="shareStatus">{shareStatus}</p> : null}
                {shareUrl ? (
                  <div className="shareLinkBox">
                    <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
                    <button className="ghostButton" type="button" onClick={() => navigator.clipboard?.writeText(shareUrl)}>
                      Copy Link
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {isDashboardPreparing ? (
            <section className="notice reportTrustNotice loading" aria-live="polite">
              Loading dashboard controls and verified report inputs. Sales and unit values will appear after the account data is ready.
            </section>
          ) : null}
          {isDashboardBlocked ? (
            <section className="notice reportTrustNotice error" aria-live="polite">
              <span>{dashboardStatus}</span>
              <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
                Try again
              </button>
            </section>
          ) : null}
          {!dashboardStatus && isReportPreparing ? (
            <section className="notice reportTrustNotice loading" aria-live="polite">
              Preparing verified report totals for {dashboardPeriodLabel}. Sales and unit values will appear when the report data is ready.
            </section>
          ) : null}
          {!dashboardStatus && isReportUpdating ? (
            <section className="notice reportTrustNotice loading" aria-live="polite">
              Updating report sections for the latest filters. Showing the previous verified report until the new totals finish loading.
            </section>
          ) : null}
          {!dashboardStatus && isReportBlocked ? (
            <section className="notice reportTrustNotice error" aria-live="polite">
              <span>{serverReportStatus} The scoreboard is paused so this does not read as a zero-sales period.</span>
              <button type="button" onClick={() => setReportRefreshKey((key) => key + 1)}>
                Rebuild report
              </button>
            </section>
          ) : null}
          {isConfirmedEmptyReport ? (
            <section className="notice reportTrustNotice empty" aria-live="polite">
              Confirmed zero: no records match the current account, period, and brand/class filters.
            </section>
          ) : null}

          <section className="sectionBlock" id="scorecards">
            <div className="sectionTitle">
              <div>
                <h3>{selectedPeriodKind === "year" ? "Year Scorecard" : "YTD Scorecard"}</h3>
                <p>{ytdDecisionSummary}</p>
              </div>
            </div>

            <div className="ytdTrackerLayout">
              <MiniLineChart current={ytdLine.current} prior={ytdLine.prior} currentYear={selectedYear} />

              <div className="ytdTrackerTiles">
                <MetricCard label={selectedYear ? `${selectedYear} YTD` : "Current YTD"} value={currencyText(ytdLine.currentTotal)} />
                <MetricCard label={selectedYear ? `${selectedYear - 1} YTD` : "Prior YTD"} value={currencyText(ytdLine.priorTotal)} />
                <MetricCard label="Total Change" value={signedCurrencyText(ytdLine.currentTotal - ytdLine.priorTotal)} tone={ytdLine.currentTotal - ytdLine.priorTotal} />
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

          <section className="sectionBlock" id="monthly-scorecard">
            <div className="sectionTitle">
              <div>
                <h3>{selectedPeriodKind === "year" ? "Selected Year Scorecard" : "Monthly Scorecard"}</h3>
                <p>{monthlyDecisionSummary}</p>
              </div>
            </div>

            <SalesDriverGrid
              current={currentMetrics}
              drivers={monthlyDrivers}
              periodTitle={selectedPeriodTitle}
              priorPeriodTitle={priorPeriodTitle}
              prior={priorMetrics}
            />
          </section>

          {selectedPeriodKind === "month" && weeklyScorecards.length ? (
            <section className="sectionBlock" id="weekly-scorecard">
              <div className="sectionTitle">
                <div>
                  <h3>Weekly Scorecard</h3>
                  <p>{weeklyDecisionSummary}</p>
                </div>
              </div>
              <WeeklyScorecard rows={weeklyScorecards} />
            </section>
          ) : null}

          {inventorySnapshot ? (
            <section className="sectionBlock inventorySection" id="inventory-snapshot">
              <div className="sectionTitle">
                <div>
                  <h3>Inventory Snapshot</h3>
                  <p>{inventoryDecisionSummary}</p>
                </div>
              </div>
              <InventoryCard snapshot={inventorySnapshot} />
            </section>
          ) : null}

          {productGalleryRows.length || inventoryTrackerMeta || topArt.length ? (
            <section className="sectionBlock" id="product-gallery">
              <div className="sectionTitle">
                <div>
                  <h3>Top Performers</h3>
                  <p>{productGalleryDecisionSummary}</p>
                </div>
                {supportsProductImageFetch(selectedCustomer?.name ?? "") ? (
                  <div className="productGalleryHeaderActions" aria-live="polite">
                    <div className="imageCacheControl">
                      <button type="button" onClick={() => void cacheMissingImages()} disabled={imageCacheRunning || missingImageCount === 0}>
                        {imageCacheRunning ? `Caching ${numberText(missingImageCount)} Images` : missingImageCount ? `Cache ${numberText(missingImageCount)} Images` : "Images Current"}
                      </button>
                    </div>
                    <small title={imageCacheStatus}>{imageCacheStatus || "\u00a0"}</small>
                  </div>
                ) : null}
              </div>
              <div className="inventoryControls" ref={inventoryControlsRef}>
                <div className="inventoryDropdownControls">
                  <div className={`inventoryDropdown ${inventoryMenuOpen === "view" ? "isOpen" : ""}`}>
                    <button
                      aria-expanded={inventoryMenuOpen === "view"}
                      className="inventoryDropdownTrigger"
                      type="button"
                      onClick={() => setInventoryMenuOpen((current) => (current === "view" ? null : "view"))}
                    >
                      <span>View</span>
                      <strong>{productGalleryViewLabel(productGalleryView)}</strong>
                    </button>
                    {inventoryMenuOpen === "view" ? (
                      <div className="inventoryDropdownMenu">
                        {(["top-sellers", "inventory"] as ProductGalleryView[]).map((view) => (
                          <button
                            aria-pressed={productGalleryView === view}
                            className={`inventoryOption ${productGalleryView === view ? "active" : ""}`}
                            key={view}
                            type="button"
                            onClick={() => applyProductGalleryView(view)}
                          >
                            <span className="inventoryOptionMark" aria-hidden="true" />
                            <span>{productGalleryViewLabel(view)}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className={`inventoryDropdown ${inventoryMenuOpen === "sort" ? "isOpen" : ""}`}>
                    <button
                      aria-expanded={inventoryMenuOpen === "sort"}
                      className="inventoryDropdownTrigger"
                      type="button"
                      onClick={() => setInventoryMenuOpen((current) => (current === "sort" ? null : "sort"))}
                    >
                      <span>Sort</span>
                      <strong>{productGallerySortLabel}</strong>
                    </button>
                    {inventoryMenuOpen === "sort" ? (
                      <div className="inventoryDropdownMenu">
                        {(["units", "dollars", "inventory-high", "inventory-low"] as ProductGallerySort[]).map((sort) => (
                          <button
                            aria-pressed={productGallerySortLabel === productGallerySortOptionLabel(sort)}
                            className={`inventoryOption ${productGallerySortLabel === productGallerySortOptionLabel(sort) ? "active" : ""}`}
                            key={sort}
                            type="button"
                            onClick={() => applyProductGallerySort(sort)}
                          >
                            <span className="inventoryOptionMark" aria-hidden="true" />
                            <span>{productGallerySortOptionLabel(sort)}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className={`inventoryDropdown ${inventoryMenuOpen === "refine" ? "isOpen" : ""}`}>
                    <button
                      aria-expanded={inventoryMenuOpen === "refine"}
                      className="inventoryDropdownTrigger"
                      type="button"
                      onClick={() => setInventoryMenuOpen((current) => (current === "refine" ? null : "refine"))}
                    >
                      <span>Refine</span>
                      <strong>{productGalleryRefineLabel}</strong>
                    </button>
                    {inventoryMenuOpen === "refine" ? (
                      <div className="inventoryDropdownMenu wide refineMenu">
                        {productGalleryActiveRefinements.length ? (
                          <button
                            className="inventoryResetOption"
                            type="button"
                            onClick={clearInventoryFilters}
                          >
                            Clear filters
                          </button>
                        ) : null}
                        <div className="inventoryOptionGroup">
                          <p>Audience</p>
                          {(["All", ...INVENTORY_AUDIENCE_FILTERS] as InventoryAudienceFilter[]).map((filter) => (
                            <button
                              aria-pressed={inventoryAudienceFilter === filter}
                              className={`inventoryOption ${inventoryAudienceFilter === filter ? "active" : ""}`}
                              key={filter}
                              type="button"
                              onClick={() => applyInventoryAudienceFilter(filter)}
                            >
                              <span className="inventoryOptionMark" aria-hidden="true" />
                              <span>{inventoryAudienceFilterLabel(filter)}</span>
                            </button>
                          ))}
                        </div>
                        <div className="inventoryOptionGroup">
                          <p>Product Type</p>
                          {INVENTORY_PRODUCT_FILTERS.map((filter) => (
                            <button
                              aria-pressed={inventoryProductFilters.includes(filter)}
                              className={`inventoryOption ${inventoryProductFilters.includes(filter) ? "active" : ""}`}
                              key={filter}
                              type="button"
                              onClick={() => toggleInventoryProductFilter(filter)}
                            >
                              <span className="inventoryOptionMark square" aria-hidden="true" />
                              <span>{filter}</span>
                            </button>
                          ))}
                        </div>
                        <div className="inventoryOptionGroup">
                          <p>Show</p>
                          {PRODUCT_GALLERY_DISPLAY_OPTIONS.map((limit) => (
                            <button
                              aria-pressed={productGalleryDisplayLimit === limit}
                              className={`inventoryOption ${productGalleryDisplayLimit === limit ? "active" : ""}`}
                              key={limit}
                              type="button"
                              onClick={() => applyProductGalleryDisplayLimit(limit)}
                            >
                              <span className="inventoryOptionMark" aria-hidden="true" />
                              <span>{productGalleryDisplayLimitLabel(limit)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                {productGalleryActiveRefinements.length ? (
                  <div className="inventoryActiveFilters" aria-label="Active product gallery filters">
                    {productGalleryActiveRefinements.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                    <button type="button" onClick={clearInventoryFilters}>
                      Clear
                    </button>
                  </div>
                ) : null}
              </div>
              {productGalleryRows.length ? (
                <div className="artGrid">
                  {productGalleryRows.map((row) => (
                    <article className="artCard" key={row.key}>
                      <div className="artImage">
                        <b>#{row.rank}</b>
                        {row.imageUrl ? (
                          <ProductMedia
                            alt={`${row.style} ${row.artCode}`}
                            sizes="(max-width: 760px) 50vw, (max-width: 1180px) 25vw, 220px"
                            src={row.imageUrl}
                          />
                        ) : <span>No Image</span>}
                      </div>
                      <div className="artMeta">
                        <div className="artIdentity">
                          {row.productUrl ? (
                            <a className="artCodeLink" href={row.productUrl} target="_blank" rel="noreferrer">
                              {row.artCode}
                            </a>
                          ) : (
                            <strong>{row.artCode}</strong>
                          )}
                          <span>{row.style} | {row.color}</span>
                        </div>
                        <div className="artStats">
                        {row.inventoryUnits != null ? <span><em>On-Hand</em><strong>{numberText(row.inventoryUnits)} Units</strong></span> : null}
                        {row.inventoryUnits != null ? <i aria-hidden="true" className="artStatsDivider" /> : null}
                        {!productGalleryUsesInventory || row.monthUnits > 0 || row.monthSales > 0 ? (
                          <span><em>{selectedPeriodKind === "year" ? "Year" : "Month"}</em><strong>{productCardSalesText(row.monthUnits, row.monthSales)}</strong></span>
                        ) : null}
                        <span><em>YTD</em><strong>{productCardSalesText(row.ytdUnits, row.ytdSales)}</strong></span>
                        <span><em>LY</em><strong>{inventoryPriorYearSoldText(row.priorYearUnits)}</strong></span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="emptyNotice">
                  <span>No product gallery items match the selected filters.</span>
                  <button type="button" onClick={clearInventoryFilters}>
                    Clear filters
                  </button>
                </div>
              )}
            </section>
          ) : null}

          <p className="siteCopyright">Copyright Lester Sales {new Date().getFullYear()}</p>
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
      <p>Styles / Colors / Arts</p>
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
          Arts
          <em>{numberText(insights.priorArtworksSold)} LY</em>
        </span>
      </div>
    </article>
  );
}

function SalesDriverGrid({ current, prior, drivers, periodTitle, priorPeriodTitle }: {
  current: MetricSet;
  prior: MetricSet;
  drivers: ReturnType<typeof monthlyDriverMetrics>;
  periodTitle: string;
  priorPeriodTitle: string;
}) {
  const salesDelta = current.sales - prior.sales;
  const unitDelta = current.units - prior.units;
  const transactionDelta = current.transactions - prior.transactions;
  const avgTransactionDelta = drivers.avgSalePerTransaction - drivers.priorAvgSalePerTransaction;
  const avgUnitDelta = drivers.avgSalePerUnit - drivers.priorAvgSalePerUnit;
  const hasTransactionData = hasComparableTransactionData(current, prior);
  const maxSales = Math.max(current.sales, prior.sales, 1);
  const currentSalesWidth = Math.max(3, (current.sales / maxSales) * 100);
  const priorSalesWidth = Math.max(3, (prior.sales / maxSales) * 100);
  const takeaways = [
    `Sales are ${changeText(current.sales, prior.sales).toLowerCase()} (${signedCurrencyText(salesDelta)}) vs last year.`,
    hasTransactionData
      ? `Units are ${changeText(current.units, prior.units).toLowerCase()}; transactions are ${changeText(current.transactions, prior.transactions).toLowerCase()}.`
      : `Units are ${changeText(current.units, prior.units).toLowerCase()}.`,
    hasTransactionData
      ? `Average transaction is ${currencyText(drivers.avgSalePerTransaction)} vs ${currencyText(drivers.priorAvgSalePerTransaction)} LY.`
      : `Average dollars per unit are ${currencyText(drivers.avgSalePerUnit)} vs ${currencyText(drivers.priorAvgSalePerUnit)} LY.`,
    `Top 5 styles drove ${drivers.topFiveStyleShare.toFixed(1)}% of sales (${currencyText(drivers.topFiveStyleSales)}).`,
  ];

  return (
    <div className="salesDriverGrid monthlyScorecardGrid">
      <article className={`monthlyScorecardHero ${changeClass(salesDelta)}`}>
        <div className="monthlyScorecardTotal">
          <span>{periodTitle}</span>
          <strong>{currencyText(current.sales)}</strong>
          <em>{signedCurrencyText(salesDelta)} vs {priorPeriodTitle}</em>
        </div>
        <div className="monthlyScorecardBars" aria-label="Current sales compared with last year">
          <div className="monthlyScorecardBarRow">
            <span>{periodTitle}</span>
            <div className="monthlyScorecardTrack">
              <i style={{ width: `${currentSalesWidth}%` }} />
            </div>
            <strong>{currencyText(current.sales)}</strong>
          </div>
          <div className="monthlyScorecardBarRow prior">
            <span>{priorPeriodTitle}</span>
            <div className="monthlyScorecardTrack">
              <i style={{ width: `${priorSalesWidth}%` }} />
            </div>
            <strong>{currencyText(prior.sales)}</strong>
          </div>
        </div>
      </article>

      <article className="monthlyScorecardTakeaways">
        <p>Summary</p>
        <ul>
          {takeaways.map((takeaway) => (
            <li key={takeaway}>{takeaway}</li>
          ))}
        </ul>
      </article>

      <div className="monthlyDriverMetricsRow monthlyScorecardMetrics">
        <DriverTile
          label="Transactions"
          value={hasTransactionData ? `${numberText(current.transactions)} vs ${numberText(prior.transactions)} LY` : "NA"}
          details={[hasTransactionData ? `Change: ${deltaText(transactionDelta, current.transactions, prior.transactions)}` : "No receipt data"]}
          tone={hasTransactionData ? transactionDelta : 0}
        />
        <DriverTile
          label="Units"
          value={`${numberText(current.units)} vs ${numberText(prior.units)} LY`}
          details={[
            `Change: ${deltaText(unitDelta, current.units, prior.units)}`,
            `Avg $ / unit: ${currencyText(drivers.avgSalePerUnit)} vs ${currencyText(drivers.priorAvgSalePerUnit)} LY`,
          ]}
          tone={unitDelta}
        />
        {hasTransactionData ? (
          <DriverTile
            label="Avg Transaction"
            value={currencyText(drivers.avgSalePerTransaction)}
            details={[
              `${decimalText(drivers.avgUnitsPerTransaction)} units / transaction`,
              `LY: ${currencyText(drivers.priorAvgSalePerTransaction)} | ${decimalText(drivers.priorAvgUnitsPerTransaction)} units`,
            ]}
            tone={avgTransactionDelta}
          />
        ) : (
          <DriverTile
            label="Avg $ / Unit"
            value={currencyText(drivers.avgSalePerUnit)}
            details={[`LY: ${currencyText(drivers.priorAvgSalePerUnit)}`]}
            tone={avgUnitDelta}
          />
        )}
        <DriverTile
          label="Top Style Dependence"
          value={`${drivers.topFiveStyleShare.toFixed(1)}%`}
          details={[`Top 5 styles: ${currencyText(drivers.topFiveStyleSales)}`]}
          tone={0}
        />
      </div>
    </div>
  );
}

function DriverTile({ label, value, details, tone }: { label: string; value: string; details: string[]; tone: number }) {
  return (
    <article className={`driverTile ${changeClass(tone)}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <ul className="driverMeta">
        {details.map((detail) => (
          <li className={detail.startsWith("Change:") ? changeClass(tone) : ""} key={detail}>{detail}</li>
        ))}
      </ul>
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
        const hasSalesActivity =
          row.current.sales !== 0 || row.current.units !== 0 || row.prior.sales !== 0 || row.prior.units !== 0;
        const hasTransactionData = hasComparableTransactionData(row.current, row.prior);
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
                <strong>{hasTransactionData ? numberText(row.current.transactions) : "NA"}</strong>
                <small className={hasTransactionData ? changeClass(transactionDelta) : ""}>
                  {hasTransactionData ? `${signedNumberText(transactionDelta)} vs LY` : hasSalesActivity ? "No receipt data" : "0 vs LY"}
                </small>
              </span>
            </div>

            <div className="weeklyTopProducts">
              <span>Top 3 Products</span>
              {row.topItems.length ? (
                <div className="weeklyTopProductList">
                  {row.topItems.map((item) => (
                    <div className="weeklyTopProduct" key={`${item.style}-${item.artCode}-${item.color}`}>
                      {item.imageUrl ? (
                        <ProductMedia
                          alt={`${item.style} ${item.artCode}`}
                          height={76}
                          sizes="76px"
                          src={item.imageUrl}
                          width={76}
                        />
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
          <span>Arts In Stock</span>
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
  const hasDailySales = bestDay.dayCount > 1;
  const items = bestDay.items.slice(0, 3);
  return (
    <article className="insightCard topSalesItemsCard">
      <div className="cardHeading">
        <h4>{hasDailySales ? "Best Sales Day" : "Top 3 Sales Items"}</h4>
        <strong>{hasDailySales ? dateText(bestDay.date) : periodTitle}</strong>
      </div>
      <p className="compactLine">
        {currencyText(bestDay.sales)} | {numberText(bestDay.units)} units
        {hasDailySales ? ` | ${numberText(bestDay.transactions)} transactions` : ""}
      </p>
      {items.length ? (
        <div className="topSalesProductList">
          {items.map((item) => (
            <div className="topSalesProduct" key={`${item.style}-${item.artCode}-${item.color}`}>
              <span className="topSalesRank">#{item.rank}</span>
              {item.imageUrl ? (
                <ProductMedia
                  alt={`${item.style} ${item.artCode}`}
                  height={72}
                  sizes="72px"
                  src={item.imageUrl}
                  width={72}
                />
              ) : (
                <div className="weeklyTopProductPlaceholder">No Image</div>
              )}
              <div className="topSalesProductText">
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
    </article>
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

function scheduleDashboardIdle(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const idleWindow = window as IdleWindow;

  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 1200 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const timeout = window.setTimeout(callback, 160);
  return () => window.clearTimeout(timeout);
}

function openDashboardCache() {
  return new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DASHBOARD_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DASHBOARD_CACHE_STORE)) {
        db.createObjectStore(DASHBOARD_CACHE_STORE, { keyPath: "customerId" });
      }
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

function normalizeCachedDashboard(value: unknown): DashboardData | null {
  const entry = value as Partial<DashboardCacheEntry> | null;
  const data = entry?.data;
  if (!data || !Array.isArray(data.records)) return null;
  return {
    records: data.records,
    inventoryRecords: Array.isArray(data.inventoryRecords) ? data.inventoryRecords : [],
    images: Array.isArray(data.images) ? data.images : [],
  };
}

async function readDashboardCache(customerId: string) {
  const db = await openDashboardCache();
  if (!db) return null;

  return new Promise<DashboardData | null>((resolve) => {
    const transaction = db.transaction(DASHBOARD_CACHE_STORE, "readonly");
    const request = transaction.objectStore(DASHBOARD_CACHE_STORE).get(customerId);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(normalizeCachedDashboard(request.result));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
}

async function writeDashboardCache(customerId: string, data: DashboardData) {
  const db = await openDashboardCache();
  if (!db) return;

  return new Promise<void>((resolve) => {
    const transaction = db.transaction(DASHBOARD_CACHE_STORE, "readwrite");
    transaction.objectStore(DASHBOARD_CACHE_STORE).put({ customerId, cachedAt: Date.now(), data });
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
  });
}

function rememberReportPayload(cache: Map<string, ReportSnapshotPayload>, key: string, payload: ReportSnapshotPayload) {
  if (!key) return;
  cache.set(key, payload);
  while (cache.size > REPORT_CACHE_LIMIT) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) break;
    cache.delete(firstKey);
  }
}

type DatedRecord = {
  transaction_date: string | null;
};

function availableMonths(records: DatedRecord[]) {
  return [...new Set(records.map((record) => monthKey(record.transaction_date)).filter((month): month is string => Boolean(month)))]
    .sort()
    .reverse();
}

function availableYears(records: DatedRecord[]) {
  return [...new Set(records.map((record) => monthKey(record.transaction_date)?.slice(0, 4)).filter((year): year is string => Boolean(year)))]
    .sort()
    .reverse();
}

function defaultPeriodValue(records: DatedRecord[]) {
  const month = availableMonths(records)[0];
  return month ? `month:${month}` : null;
}

function defaultPeriodValueFromMonths(months: string[]) {
  const month = months[0];
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

function periodTitle<T extends DatedRecord>(period: PeriodSelection | null, endMonth: string | null, periodRecords: T[] = []) {
  if (!period) return "-";
  if (period.kind === "month") {
    const range = recordDateRange(periodRecords);
    return range ? comparisonRangeTitle(range.startDate, range.endDate, period.value) : monthText(period.value);
  }
  return yearLabel(period.year, endMonth);
}

function topPerformingRangeTitle<T extends DatedRecord>(period: PeriodSelection | null, endMonth: string | null, periodRecords: T[] = []) {
  if (!period) return "-";
  if (period.kind !== "month") return yearLabel(period.year, endMonth);

  const range = recordDateRange(periodRecords.filter((record) => monthKey(record.transaction_date) === period.value));
  if (!range) return monthText(period.value);

  return fullMonthDayRangeText(`${period.value}-01`, range.endDate);
}

function fullMonthDayRangeText(startDate: string, endDate: string) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const startMonth = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(start);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();

  if (!sameMonth) return dateRangeText(start, end);
  if (dateKey(start) === dateKey(end)) {
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(start);
  }

  return `${startMonth} ${start.getUTCDate()}-${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}

function priorTitle<T extends DatedRecord>(period: PeriodSelection | null, endMonth: string | null, periodRecords: T[] = [], records: T[] = []) {
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

function recordDateRange<T extends DatedRecord>(records: T[]) {
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

function priorYearComparisonRange<T extends DatedRecord>(period: PeriodSelection, periodRecords: T[]) {
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

function latestMonthForYear(records: DatedRecord[], year: number) {
  return availableMonths(records).filter((month) => month.startsWith(`${year}-`))[0] ?? `${year}-12`;
}

function latestMonthForShellYear(shell: DashboardShellSummary, brandFilter: string, year: number) {
  const yearKey = String(year);
  if (brandFilter !== "All") {
    const brandMonth = shell.latestMonthByBrandYear[brandFilter]?.[yearKey];
    if (brandMonth) return brandMonth;
  }
  return shell.latestMonthByYear[yearKey] ?? `${year}-12`;
}

function recordsForSelectedPeriod<T extends DatedRecord>(records: T[], period: PeriodSelection) {
  if (period.kind === "month") return recordsForPeriod(records, period.value, "monthly");
  return recordsForYear(records, period.year);
}

function recordsForPriorPeriod<T extends DatedRecord>(records: T[], period: PeriodSelection, periodRecords: T[] = []) {
  if (period.kind === "month") {
    return priorPeriodComparison(records, period, periodRecords).records;
  }
  return recordsForYear(records, period.year - 1);
}

function priorPeriodComparison<T extends DatedRecord>(records: T[], period: PeriodSelection, periodRecords: T[] = []) {
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

function recordsForYear<T extends DatedRecord>(records: T[], year: number) {
  return records.filter((record) => monthKey(record.transaction_date)?.slice(0, 4) === String(year));
}

function recordsForPeriod<T extends DatedRecord>(records: T[], month: string, periodMode: "monthly" | "ytd") {
  return records.filter((record) => {
    const recordMonth = monthKey(record.transaction_date);
    if (!recordMonth) return false;
    if (periodMode === "monthly") return recordMonth === month;
    return recordMonth.slice(0, 4) === month.slice(0, 4) && recordMonth <= month;
  });
}

function currentYearRecords<T extends DatedRecord>(records: T[], month: string | null) {
  if (!month) return [];
  return records.filter((record) => {
    const recordMonth = monthKey(record.transaction_date);
    return recordMonth?.slice(0, 4) === month.slice(0, 4) && recordMonth <= month;
  });
}

function recordsForDateRange<T extends DatedRecord>(records: T[], startDate: string, endDate: string) {
  return records.filter((record) => {
    const date = record.transaction_date;
    return Boolean(date && date >= startDate && date <= endDate);
  });
}

function periodComparisonEndDate<T extends DatedRecord>(month: string | null, periodRecords: T[] = []) {
  if (!month) return null;
  const range = recordDateRange(periodRecords.filter((record) => monthKey(record.transaction_date) === month));
  return range?.endDate ?? dateKey(endOfMonth(parseDate(`${month}-01`)));
}

function currentYtdRecordsForPeriod<T extends DatedRecord>(records: T[], month: string | null, periodRecords: T[] = []) {
  const endDate = periodComparisonEndDate(month, periodRecords);
  if (!month || !endDate) return [];
  return recordsForDateRange(records, `${month.slice(0, 4)}-01-01`, endDate);
}

function priorYtdRecordsForPeriod<T extends DatedRecord>(records: T[], month: string | null, periodRecords: T[] = []) {
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
  const transactionKeys = records.map(transactionKey).filter(Boolean);
  return {
    sales: sum(records.map(amountValue)),
    units: sum(records.map((record) => record.units ?? 0)),
    transactions: transactionKeys.length ? uniqueCount(transactionKeys) : 0,
    transactionsKnown: transactionKeys.length > 0,
  };
}

function salesTransactionCount(records: SalesRecord[]) {
  const transactionKeys = records.map(transactionKey).filter(Boolean);
  return transactionKeys.length ? uniqueCount(transactionKeys) : 0;
}

function transactionKey(record: SalesRecord) {
  const transactionNumber = clean(record.transaction_number);
  if (!transactionNumber) return "";
  return `${record.transaction_date}|${transactionNumber}`;
}

function topArtRows(
  records: SalesRecord[],
  ytdRecords: SalesRecord[],
  images: ProductImage[],
  inventoryRecords: InventoryRecord[] = [],
  sort: TopArtSort = "units",
  priorYearRecords: SalesRecord[] = [],
  limit: number | null = INVENTORY_TRACKER_PAGE_SIZE,
): TopArt[] {
  const ytdGroups = groupBy(ytdRecords, artKey);
  const priorYearGroups = groupBy(priorYearRecords, artKey);
  const imageLookup = imageLookupMaps(images);
  const latestInventory = latestStandaloneInventoryRecords(inventoryRecords);
  const inventoryGroups = groupBy(latestInventory, artKey);
  const rows = groupedRows(records, artKey)
    .map(([key, group]) => {
      const first = group[0];
      const style = normalizedStyle(first);
      const artCode = displayArtCode(first);
      const color = colorName(first);
      const cyGroup = ytdGroups.get(key) ?? [];
      const priorYearGroup = priorYearGroups.get(key) ?? [];
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
        transactions: salesTransactionCount(group),
        cySales: sum(cyGroup.map(amountValue)),
        cyUnits: sum(cyGroup.map((record) => record.units ?? 0)),
        priorYearUnits: priorYearGroup.length ? sum(priorYearGroup.map((record) => record.units ?? 0)) : null,
        inventoryUnits: inventoryResult.units,
        inventoryScope: inventoryResult.scope,
        imageUrl: findProductImageUrl(imageLookup, style, artCode, color),
        productUrl: findProductPageUrl(imageLookup, style, artCode, color),
      };
    })
    .sort(sort === "dollars" ? sortBySales : sortByUnits);
  const limitedRows = limit == null ? rows : rows.slice(0, limit);
  return limitedRows.map((row, index) => ({ ...row, rank: index + 1 }));
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
  [imageKey("CS3050", "AEC03612724", "SILVERGREY")]: "https://www.utvolshop.com/site/product-images/368238p_02.jpg?resizeid=3&resizeh=1200&resizew=1200",
  [imageKey("CS3051", "AEC03612724", "SILVERGREY")]: "https://www.utvolshop.com/site/product-images/368238p_02.jpg?resizeid=3&resizeh=1200&resizew=1200",
};

const knownRebelRagsImages: Record<string, string> = {
  [imageKey("CB1012", "AEC04157156", "SPIRITEDORANGE")]: "/images/product-overrides/rebel-rags-cb1012-aec04157156-spirited-orange.png",
  [imageKey("C6065", "APC04058491", "WHITE")]: "/images/product-overrides/rebel-rags-c6065-apc04058491-white.png",
  [imageKey("CS1271", "APC03783493", "HEATHERGREY")]: "/images/product-overrides/rebel-rags-cs1271-apc03783493-heather-grey.png",
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
  if (normalizedColor === "SILVERGREY") terms.push("SILVERGRAY", "GREY", "GRAY");
  if (normalizedColor === "SILVERGRAY") terms.push("SILVERGREY", "GREY", "GRAY");
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
      transactions: salesTransactionCount(group),
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
        transactions: salesTransactionCount(group),
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
    transactions: salesTransactionCount(dayRecords),
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
    style === "CB1012" &&
    (artCode === "CB10124111NEW0415" || artCode === "NEW0415" || compactImagePart(record.raw_style_identifier).includes("NEW0415"))
  ) {
    return "AEC04157156";
  }

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
  if (isSpiritedOrangeAnorak(record)) return "Spirited Orange";
  if (isYouthHoodHeatherGrey(record)) return "Heather Grey";
  if (isReverseWeaveSilverGrey(record)) return "Silver Grey";
  return displayColorName(clean(record.catalog_color_name) || clean(record.color)) || "-";
}

function isSpiritedOrangeAnorak(record: MerchandiseRecord) {
  return normalizedStyle(record) === "CB1012"
    && (
      colorCodeFromStyleIdentifier(record) === "4111" ||
      compactImagePart(record.color_code) === "4111" ||
      compactImagePart(record.raw_style_identifier).includes("4111NEW0415") ||
      compactImagePart(record.art_code) === "AEC04157156"
    );
}

function isYouthHoodHeatherGrey(record: MerchandiseRecord) {
  return normalizedStyle(record) === "CS1271"
    && compactImagePart(record.art_code) === "APC03783493"
    && ["GREY", "GRAY", "HEATHERGREY", "HEATHERGRAY"].includes(compactImagePart(clean(record.catalog_color_name) || clean(record.color)));
}

function isReverseWeaveSilverGrey(record: MerchandiseRecord) {
  return INVENTORY_REVERSE_WEAVE_STYLES.has(normalizedStyle(record))
    && (colorCodeFromStyleIdentifier(record) === "940" || compactImagePart(record.color_code) === "940");
}

const STYLE_NUMBER_ALIASES: Record<string, string> = {
  CS127: "CS1271",
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
        ytdSales: sum((ytdGroups.get(key) ?? []).map(amountValue)),
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

function latestDate(records: DatedRecord[]) {
  return records.map((record) => record.transaction_date).sort().at(-1) ?? null;
}

function dateInputValue(value: string | null) {
  return value?.slice(0, 10) ?? "";
}

function uploadedAtText(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

function hasComparableTransactionData(current: MetricSet, prior: MetricSet) {
  const currentKnown = current.transactionsKnown ?? current.transactions > 0;
  const priorKnown = prior.transactionsKnown ?? prior.transactions > 0;
  const priorHasActivity = prior.sales !== 0 || prior.units !== 0 || prior.transactions !== 0;
  return currentKnown && (priorKnown || !priorHasActivity);
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

function signedPercentText(current: number, prior: number) {
  if (!prior) return current ? "New" : "0.0%";
  const percent = ((current - prior) / prior) * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function deltaText(delta: number, current: number, prior: number) {
  return `${signedNumberText(delta)} (${signedPercentText(current, prior)})`;
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

function productCardSalesText(units: number, sales: number | null | undefined) {
  const unitText = `${numberText(units)} Units`;
  return sales ? `${unitText} (${wholeCurrencyText(sales)})` : unitText;
}

function productGalleryViewLabel(view: ProductGalleryView) {
  if (view === "top-sellers") return "Top Sellers";
  return "Inventory";
}

function productGallerySortOptionLabel(sort: ProductGallerySort) {
  if (sort === "units") return "Units";
  if (sort === "dollars") return "Dollars";
  if (sort === "inventory-high") return "Inventory High";
  return "Inventory Low";
}

function productGalleryDisplayLimitLabel(limit: ProductGalleryDisplayLimit) {
  return limit === "all" ? "All" : String(limit);
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

type VolshopCumulativeRecord = {
  transaction_date: string;
  parent_sku?: string | null;
  sku?: string | null;
  product_class?: string | null;
  master_style?: string | null;
  color?: string | null;
  size?: string | null;
  catalog_color_name?: string | null;
  style_number?: string | null;
  raw_style_identifier?: string | null;
  art_code?: string | null;
  year_to_date_amount?: number | string | null;
  year_to_date_units?: number | null;
};

async function applyVolshopCumulativeDeltas(
  client: SupabaseClient,
  customerId: string,
  records: ParsedSalesRecord[],
  salesPeriodStart: string | null,
) {
  const startDate = salesPeriodStart ?? records.map((record) => record.transaction_date).sort()[0] ?? null;
  if (!startDate) {
    return { records, deltaCount: 0, fallbackCount: records.length };
  }

  const priorRecords = await loadPriorVolshopCumulativeRecords(client, customerId, startDate);
  const priorByKey = new Map<string, VolshopCumulativeRecord>();

  priorRecords.forEach((record) => {
    volshopCumulativeKeys(record).forEach((key) => {
      const existing = priorByKey.get(key);
      if (!existing || newerVolshopSnapshot(record, existing)) {
        priorByKey.set(key, record);
      }
    });
  });

  let deltaCount = 0;
  let fallbackCount = 0;
  const adjustedRecords = records.map((record) => {
    const prior = volshopCumulativeKeys(record)
      .map((key) => priorByKey.get(key))
      .find(Boolean);
    const currentYtdUnits = nullableNumber(record.year_to_date_units);
    const currentYtdAmount = nullableNumber(record.year_to_date_amount);
    const priorYtdUnits = nullableNumber(prior?.year_to_date_units);
    const priorYtdAmount = nullableNumber(prior?.year_to_date_amount);

    if (
      prior &&
      currentYtdUnits != null &&
      currentYtdAmount != null &&
      priorYtdUnits != null &&
      priorYtdAmount != null
    ) {
      deltaCount += 1;
      return {
        ...record,
        amount: roundCurrency(currentYtdAmount - priorYtdAmount),
        units: Math.round(currentYtdUnits - priorYtdUnits),
      };
    }

    fallbackCount += 1;
    return record;
  });

  return { records: adjustedRecords, deltaCount, fallbackCount };
}

async function loadPriorVolshopCumulativeRecords(
  client: SupabaseClient,
  customerId: string,
  startDate: string,
) {
  const yearStart = `${startDate.slice(0, 4)}-01-01`;
  const rows: VolshopCumulativeRecord[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("sales_records")
      .select(
        "transaction_date,parent_sku,sku,product_class,master_style,color,size,catalog_color_name,style_number,raw_style_identifier,art_code,year_to_date_amount,year_to_date_units",
      )
      .eq("customer_id", customerId)
      .gte("transaction_date", yearStart)
      .lt("transaction_date", startDate)
      .order("transaction_date", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as VolshopCumulativeRecord[]));
    if (!data || data.length < pageSize) break;
  }

  return rows.filter((row) => row.year_to_date_amount != null || row.year_to_date_units != null);
}

function volshopCumulativeKeys(record: VolshopCumulativeRecord) {
  const color = record.catalog_color_name || record.color;
  const keys = [
    record.sku ? ["sku", record.sku] : [],
    record.parent_sku && record.size ? ["parent-size", record.parent_sku, record.size] : [],
    record.style_number && record.art_code && color && record.size
      ? ["style-art-color-size", record.style_number, record.art_code, color, record.size]
      : [],
    record.raw_style_identifier && color && record.size
      ? ["raw-color-size", record.raw_style_identifier, color, record.size]
      : [],
    record.master_style && color && record.size
      ? ["master-color-size", record.master_style, color, record.size]
      : [],
  ];

  return keys
    .filter((parts) => parts.length > 1)
    .map((parts) => parts.map(compactKey).join("|"))
    .filter((key) => key.replace(/\|/g, "").length > 0);
}

function newerVolshopSnapshot(left: VolshopCumulativeRecord, right: VolshopCumulativeRecord) {
  if (left.transaction_date !== right.transaction_date) {
    return left.transaction_date > right.transaction_date;
  }
  return (nullableNumber(left.year_to_date_units) ?? 0) >= (nullableNumber(right.year_to_date_units) ?? 0);
}

function nullableNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
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
  replacementStartDate?: string | null,
  replacementEndDate?: string | null,
) {
  const dates = [...new Set(records.map((record) => record.transaction_date))].sort();
  const classes = [...new Set(records.map((record) => clean(record.product_class)).filter(Boolean))].sort();
  const startDate = replacementStartDate ?? dates[0];
  const endDate = replacementEndDate ?? dates.at(-1);
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

function compactKey(value: string | number | null | undefined) {
  return (value == null ? "" : String(value)).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function fileSizeText(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("en-US")} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} MB`;
}

function firstNonBlank(values: Array<string | null | undefined>) {
  return values.map(clean).find(Boolean) ?? null;
}

function escapePostgrestPattern(value: string) {
  return value.replace(/[,%]/g, (match) => `\\${match}`);
}
