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

type MerchandiseRecord = Pick<
  SalesRecord,
  "product_class" | "master_style" | "style_number" | "raw_style_identifier" | "catalog_color_name" | "color" | "art_code"
>;

type ProductImage = {
  style_number: string;
  art_code: string;
  color: string;
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

type PeriodSelection =
  | { kind: "month"; value: string; year: number }
  | { kind: "year"; value: string; year: number };

type SalesMixSlice = {
  name: string;
  units: number;
  percent: number;
};

type InventorySnapshot = {
  date: string;
  totalUnits: number;
  styles: number;
  artworks: number;
  coverage: number | null;
  byBrand: { brand: string; units: number }[];
  topStyles: { style: string; brand: string; units: number; artworks: number }[];
} | null;

const PAGE_SIZE = 1000;
const GEAR_STYLE_PREFIXES = ["GDH", "G", "C400", "C603", "CBR", "S650", "G209"];
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
  "GDH400",
  "G1092",
  "G1093",
  "G715",
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
  const [dashboardData, setDashboardData] = useState<DashboardData>({ records: [], inventoryRecords: [], images: [] });
  const [pendingImportFiles, setPendingImportFiles] = useState<File[]>([]);
  const [importRangeStart, setImportRangeStart] = useState("");
  const [importRangeEnd, setImportRangeEnd] = useState("");
  const [dashboardStatus, setDashboardStatus] = useState("");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareScope, setShareScope] = useState<"selected" | "all">("selected");
  const [shareStatus, setShareStatus] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [navCompact, setNavCompact] = useState(false);
  const imageFetchAttempts = useRef<Set<string>>(new Set());

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
  const totalRecordsMetrics = useMemo(() => metricSet(recordsForCustomer), [recordsForCustomer]);
  const ytdCurrentRecords = useMemo(
    () => currentYearRecords(recordsForCustomer, periodEndMonth),
    [recordsForCustomer, periodEndMonth],
  );
  const ytdPriorRecords = useMemo(
    () => (priorYearMonth ? currentYearRecords(recordsForCustomer, priorYearMonth) : []),
    [priorYearMonth, recordsForCustomer],
  );
  const ytdInsights = useMemo(
    () => ytdInsightMetrics(ytdCurrentRecords, ytdPriorRecords, periodEndMonth),
    [periodEndMonth, ytdCurrentRecords, ytdPriorRecords],
  );
  const topArt = useMemo(
    () => topArtRows(periodRecords, ytdCurrentRecords, dashboardData.images, inventoryRecordsForCustomer),
    [dashboardData.images, inventoryRecordsForCustomer, periodRecords, ytdCurrentRecords],
  );
  const periodStyleStudy = useMemo(() => topStyleRows(periodRecords, comparisonRecords), [periodRecords, comparisonRecords]);
  const ytdStyleStudy = useMemo(() => topStyleRows(ytdCurrentRecords, ytdPriorRecords), [ytdCurrentRecords, ytdPriorRecords]);
  const allStyleRowsForPeriod = useMemo(() => allStyleRows(periodRecords), [periodRecords]);
  const allStyles = useMemo(() => allStyleRowsForPeriod.slice(0, 100), [allStyleRowsForPeriod]);
  const salesMix = useMemo(() => salesMixSlices(periodRecords), [periodRecords]);
  const inventorySnapshot = useMemo(
    () => inventorySnapshotForRecords(periodRecords, inventoryRecordsForCustomer, periodEndMonth),
    [inventoryRecordsForCustomer, periodEndMonth, periodRecords],
  );
  const bestDay = useMemo(() => bestSalesDay(periodRecords), [periodRecords]);
  const ytdLine = useMemo(() => ytdPoints(recordsForCustomer, periodEndMonth), [recordsForCustomer, periodEndMonth]);
  const lastUploaded = latestDate(recordsForCustomer);

  const brandOptions = useMemo(() => {
    const options = [...new Set(dashboardData.records.map(brandName))].sort();
    return ["All", ...options];
  }, [dashboardData.records]);

  useEffect(() => {
    if (!supabase || !selectedCustomerId || !selectedCustomer || !supportsProductImageFetch(selectedCustomer.name)) return;
    const client = supabase;
    const customerId = selectedCustomerId;
    const accountName = selectedCustomer.name;

    const missingRows = topArt
      .filter((row) => !row.imageUrl && row.style !== "-")
      .filter((row) => !imageFetchAttempts.current.has(imageAttemptKey(row)))
      .slice(0, 30);

    if (!missingRows.length) return;
    missingRows.forEach((row) => imageFetchAttempts.current.add(imageAttemptKey(row)));

    let isCancelled = false;

    async function fetchMissingImages() {
      const { data } = await client.auth.getSession();
      const response = await fetch("/api/rebel-rags-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
        },
        body: JSON.stringify({
          accountName,
          items: missingRows.map((row) => ({
            style: row.style,
            artCode: row.artCode,
            color: row.color,
            styleName: row.styleName,
            parentSku: row.parentSku,
            sku: row.sku,
          })),
        }),
      });

      if (!response.ok) return;
      const payload = (await response.json()) as { matches?: RebelRagsImageMatch[] };
      const matches = payload.matches?.filter((match) => match.imageUrl) ?? [];
      if (!matches.length) return;

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
  }, [selectedCustomer, selectedCustomerId, supabase, topArt]);

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

  async function createShareLink(scope: "selected" | "all" = shareScope) {
    if (!supabase || !selectedCustomer || !user || !period) return;
    const client = supabase;

    setShareStatus(scope === "all" ? "Generating all-account share link..." : "Generating share link...");
    setShareUrl("");

    const token = createReportToken();
    const generatedAt = new Date().toISOString();
    let title = `${selectedCustomer.name} ${selectedPeriodTitle} Sales Snapshot`;
    let payload: ReportSnapshotPayload | ReportSnapshotBundlePayload = buildReportPayload({
      accountName: selectedCustomer.name,
      brandFilter,
      generatedAt,
      images: dashboardData.images,
      inventoryRecords: dashboardData.inventoryRecords,
      period,
      records: dashboardData.records,
    });

    if (scope === "all" && customers.length > 1) {
      const reports = await Promise.all(
        customers.map(async (customer) => {
          if (customer.id === selectedCustomer.id) return payload as ReportSnapshotPayload;
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
            period,
            records: recordsResult.records,
          });
        }),
      );

      title = `All Accounts ${selectedPeriodTitle} Sales Snapshot`;
      payload = {
        version: 1,
        reportKind: "account_bundle",
        generatedAt,
        accountName: "All Accounts",
        brandFilter,
        periodMode: selectedPeriodKind === "month" ? "monthly" : "ytd",
        selectedMonth: periodEndMonth,
        periodTitle: selectedPeriodTitle,
        priorPeriodTitle,
        reports,
      };
    }

    const { error } = await client.from("report_snapshots").insert({
      token,
      title,
      customer_id: scope === "all" ? null : selectedCustomer.id,
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
    setPendingImportFiles(files);
  }

  function closeImportModal() {
    setPendingImportFiles([]);
    setImportRangeStart("");
    setImportRangeEnd("");
  }

  function selectedImportRange(): SalesImportOptions | null {
    if (!importRangeStart && !importRangeEnd) return {};
    if (!importRangeStart || !importRangeEnd) {
      setImportStatus("Choose both a start and end date, or leave both dates blank.");
      return null;
    }
    if (importRangeStart > importRangeEnd) {
      setImportStatus("The upload start date must be before the end date.");
      return null;
    }
    return {
      reportStartDate: importRangeStart,
      reportEndDate: importRangeEnd,
    };
  }

  async function importSalesFiles(files: File[], options: SalesImportOptions = {}) {
    if (files.length === 0) return;
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
              <label className="fileButton">
                Upload / Import
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

        {pendingImportFiles.length > 0 ? (
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
              <p>
                {pendingImportFiles.length === 1
                  ? pendingImportFiles[0].name
                  : `${numberText(pendingImportFiles.length)} files selected`}
              </p>
              {pendingImportFiles.length > 1 ? (
                <p className="muted">
                  Files will import one at a time in the order selected.
                </p>
              ) : null}
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
                  setShareScope("selected");
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
                <p>Choose exactly who this share link should show.</p>

                <div className="shareScopeGrid" role="radiogroup" aria-label="Share report scope">
                  <button
                    className={shareScope === "selected" ? "active" : ""}
                    onClick={() => setShareScope("selected")}
                    type="button"
                  >
                    <strong>{selectedCustomer?.name ?? "Selected Account"}</strong>
                    <span>Single-account link for customers or account-specific follow-up.</span>
                  </button>
                  <button
                    className={shareScope === "all" ? "active" : ""}
                    disabled={customers.length < 2}
                    onClick={() => setShareScope("all")}
                    type="button"
                  >
                    <strong>All Accounts</strong>
                    <span>{customers.map((customer) => customer.name).join(" + ")}</span>
                  </button>
                </div>

                <button className="shareGenerateButton" onClick={() => createShareLink(shareScope)} disabled={shareStatus.includes("Generating")}>
                  Generate {shareScope === "all" ? "All-Account" : "Single-Account"} Link
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
                <h3>{selectedPeriodKind === "year" ? "Year Sales Tracker" : "YTD Sales Tracker"}</h3>
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
                <h3>{selectedPeriodKind === "year" ? "Selected Year Summary" : "Monthly Sales Tracker"}</h3>
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

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>Top Performing Styles</h3>
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
                <h3>Top Performing Arts</h3>
                <p>
                  {selectedPeriodTitle} Top 30 Total: {numberText(sum(topArt.map((row) => row.units)))} Units |{" "}
                  {currencyText(sum(topArt.map((row) => row.sales)))}
                </p>
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
                    <strong>{row.artCode}</strong>
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

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>All Styles Sold</h3>
                <p>
                  Showing {numberText(allStyles.length)} of {numberText(allStyleRowsForPeriod.length)} styles for the selected period.
                </p>
              </div>
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Style</th>
                    <th>Brand/Class</th>
                    <th>Colors</th>
                    <th>Artwork</th>
                    <th>Units</th>
                    <th>Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {allStyles.map((style) => (
                    <tr key={style.style}>
                      <td>{style.rank}</td>
                      <td>{style.style}</td>
                      <td>{style.brand}</td>
                      <td>{numberText(style.colorCount)}</td>
                      <td>{numberText(style.artCount)}</td>
                      <td>{numberText(style.units)}</td>
                      <td>{currencyText(style.sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

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
      <p>Product Breadth</p>
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
      {snapshot.topStyles.length ? (
        <div className="inventoryTopStyles">
          <h4>ON-HAND INVENTORY STYLES</h4>
          {snapshot.topStyles.map((row) => (
            <div key={row.style}>
              <span>{row.brand}</span>
              <strong>{row.style}</strong>
              <em>{numberText(row.units)} units</em>
              <small>{countText(row.artworks, "artwork", "artworks")}</small>
            </div>
          ))}
        </div>
      ) : null}
    </article>
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
  current,
  prior,
  currentYear,
}: {
  current: number[];
  prior: number[];
  currentYear: number | null;
}) {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const currentValues = padMonths(current);
  const priorValues = padMonths(prior);
  const maxValue = Math.max(...currentValues, ...priorValues, 1);
  const currentMonthCount = Math.max(1, lastActiveMonthIndex(currentValues) + 1);
  const priorMonthCount = Math.max(1, lastActiveMonthIndex(priorValues) + 1);
  const displayedCurrent = currentValues.slice(0, currentMonthCount);
  const displayedPrior = priorValues.slice(0, priorMonthCount);
  const xFor = (index: number) => 12 + (index / 11) * 164;
  const yFor = (value: number) => 78 - (value / maxValue) * 66;
  const points = (values: number[]) => values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="lineCard comparativeChart">
      <div className="lineLegend">
        <span><i className="dot current" />{currentYear ?? "CY"}</span>
        <span><i className="dot prior" />{currentYear ? currentYear - 1 : "LY"}</span>
      </div>
      <svg viewBox="0 0 180 92" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Comparative sales by month">
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
        <polyline points={points(displayedPrior)} className="priorLine" />
        <polyline points={points(displayedCurrent)} className="currentLine" />
        {displayedPrior.map((value, index) => (
          <g key={`prior-${index}`}>
            <circle className="priorPoint" cx={xFor(index)} cy={yFor(value)} r="1.15" />
            {value ? (
              <text className="pointLabel priorLabel" x={xFor(index)} y={labelY(value, displayedCurrent[index] ?? 0, "prior")}>
                {compactNumber(value)}
              </text>
            ) : null}
          </g>
        ))}
        {displayedCurrent.map((value, index) => (
          <g key={`current-${index}`}>
            <circle className="currentPoint" cx={xFor(index)} cy={yFor(value)} r="1.15" />
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

function padMonths(values: number[]) {
  return Array.from({ length: 12 }, (_, index) => values[index] ?? 0);
}

function lastActiveMonthIndex(values: number[]) {
  for (let index = 11; index >= 0; index -= 1) {
    if ((values[index] ?? 0) > 0) return index;
  }
  return 0;
}

function compactNumber(value: number) {
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}K`;
  return numberText(Math.round(value));
}

async function fetchAllRecords(client: SupabaseClient, customerId: string) {
  const records: SalesRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("sales_records")
      .select("id,customer_id,transaction_date,amount,units,transaction_number,barcode,parent_sku,sku,product_class,master_style,color,size,catalog_color_name,style_number,raw_style_identifier,art_code,inventory_units,year_to_date_amount,year_to_date_units")
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
    .select("style_number,art_code,color,image_url,storage_path")
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
  period,
  records,
}: {
  accountName: string;
  brandFilter: string;
  generatedAt: string;
  images: ProductImage[];
  inventoryRecords: InventoryRecord[];
  period: PeriodSelection;
  records: SalesRecord[];
}): ReportSnapshotPayload {
  const filteredRecords = records.filter((record) => brandFilter === "All" || brandName(record) === brandFilter);
  const filteredInventoryRecords = inventoryRecords.filter((record) => brandFilter === "All" || brandName(record) === brandFilter);
  const periodEndMonth = period.kind === "month" ? period.value : latestMonthForYear(filteredRecords, period.year);
  const priorYearMonth = periodEndMonth ? `${period.year - 1}${periodEndMonth.slice(4)}` : null;
  const periodRecords = recordsForSelectedPeriod(filteredRecords, period);
  const priorPeriodRecords = recordsForPriorPeriod(filteredRecords, period);
  const ytdCurrentRecords = currentYearRecords(filteredRecords, periodEndMonth);
  const ytdPriorRecords = priorYearMonth ? currentYearRecords(filteredRecords, priorYearMonth) : [];
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
    lastUploaded: latestDate(filteredRecords),
    currentMetrics,
    priorMetrics,
    ytdLine: ytdPoints(filteredRecords, periodEndMonth),
    ytdInsights: ytdInsightMetrics(ytdCurrentRecords, ytdPriorRecords, periodEndMonth),
    monthlyDrivers: monthlyDriverMetrics(periodRecords, priorPeriodRecords),
    inventorySnapshot: inventorySnapshotForRecords(periodRecords, filteredInventoryRecords, periodEndMonth),
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
    topArt: topArtRows(periodRecords, ytdCurrentRecords, images, filteredInventoryRecords),
    allStyles: allStyleRows(periodRecords).slice(0, 100),
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
      };
    })
    .sort(sortByUnits)
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

  images.forEach((image) => {
    const url = image.resolved_url ?? image.image_url;
    if (!url) return;
    exact.set(imageKey(image.style_number, image.art_code, image.color), url);
  });

  return { exact };
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

function imageAttemptKey(row: Pick<TopArt, "style" | "artCode" | "color" | "parentSku" | "sku">) {
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

function imageUrlMatchesColor(value: string, color: string) {
  const filename = compactImagePart(imageFilename(value));
  return colorSearchTerms(color).some((term) => filename.includes(term));
}

function colorSearchTerms(color: string) {
  const normalizedColor = compactImagePart(color);
  const terms = [normalizedColor];
  if (normalizedColor === "LIGHTBLUE") terms.push("LTBLUE");
  if (normalizedColor === "GRAYCAROLINABLUE") terms.push("LIGHTBLUE", "LTBLUE", "CAROLINABLUE");
  if (normalizedColor === "HEATHERGREY") terms.push("HEATHERGRAY");
  if (normalizedColor === "SILVERGREY") terms.push("SILVERGRAY");
  if (normalizedColor === "NAVY") terms.push("MIDNIGHTNAVY");
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

function breadthMetrics(records: SalesRecord[]) {
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
  const classText = `${record.product_class ?? ""} ${record.master_style ?? ""}`.toUpperCase();
  if (classText.includes("GEAR") || classText.includes("COMFORT WASH")) return "Gear";
  if (GEAR_STYLE_PREFIXES.some((prefix) => style.startsWith(prefix))) return "Gear";
  return "Champion";
}

function audienceName(record: MerchandiseRecord) {
  const text = `${record.product_class ?? ""} ${record.master_style ?? ""}`.toUpperCase();
  if (text.includes("YOUTH") || text.includes("INFANT") || text.includes("TODDLER")) return "Youth";
  if (text.includes("WOMEN") || text.includes("WMNS") || text.includes("W-S") || text.includes("LADY") || text.includes("LADIES")) {
    return "Women's";
  }
  return "Unisex";
}

function normalizedStyle(record: MerchandiseRecord) {
  const raw = clean(record.style_number) || clean(record.raw_style_identifier) || "-";
  const upper = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const knownPrefix = [...KNOWN_STYLE_PREFIXES]
    .sort((left, right) => right.length - left.length)
    .find((prefix) => upper.startsWith(prefix));
  if (knownPrefix) return knownPrefix;
  return raw.toUpperCase().replace(/[^A-Z0-9]+$/g, "") || "-";
}

function styleKey(record: MerchandiseRecord) {
  return normalizedStyle(record);
}

function artKey(record: MerchandiseRecord) {
  return [
    compactImagePart(brandName(record)),
    normalizedStyle(record),
    compactImagePart(displayArtCode(record)),
    compactImagePart(colorName(record)),
  ].join("|");
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
): InventorySnapshot {
  const snapshotRecords = latestInventoryRecords(records, standaloneInventoryRecords, periodEndMonth);
  if (!snapshotRecords.length) return null;
  const totalUnits = sum(snapshotRecords.map((record) => record.inventory_units ?? 0));
  const monthlySalesPace = normalizedMonthlyUnitPace(records);
  return {
    date: inventoryRecordDate(snapshotRecords[0]),
    totalUnits,
    styles: uniqueCount(snapshotRecords.map(styleKey)),
    artworks: uniqueCount(snapshotRecords.map((record) => clean(record.art_code))),
    coverage: monthlySalesPace ? totalUnits / monthlySalesPace : null,
    byBrand: inventoryByBrand(snapshotRecords),
    topStyles: topInventoryStyles(snapshotRecords),
  };
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
) {
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

function changeText(current: number, prior: number) {
  if (!prior) return current ? "New" : "-";
  const percent = ((current - prior) / prior) * 100;
  return `${percent >= 0 ? "Up" : "Down"} ${Math.abs(percent).toFixed(1)}%`;
}

function signedCurrencyText(value: number) {
  if (!value) return currencyText(0);
  return `${value > 0 ? "+" : "-"}${currencyText(Math.abs(value))}`;
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
