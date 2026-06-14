"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { parseSalesWorkbook, type ParsedSalesRecord } from "@/lib/importSalesData";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { currencyText, dateText, monthText, numberText, wholeCurrencyText } from "@/lib/formatters";
import type { ReportSnapshotPayload } from "@/lib/reportSnapshot";
import type { Customer } from "@/lib/types";

type SalesRecord = {
  id: string;
  customer_id: string;
  transaction_date: string;
  amount: number | string | null;
  units: number | null;
  product_class: string | null;
  master_style: string | null;
  color: string | null;
  size: string | null;
  catalog_color_name: string | null;
  style_number: string | null;
  raw_style_identifier: string | null;
  art_code: string | null;
  inventory_units: number | null;
};

type ProductImage = {
  style_number: string;
  art_code: string;
  color: string;
  image_url: string | null;
  storage_path: string | null;
  resolved_url?: string | null;
};

type DashboardData = {
  records: SalesRecord[];
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
  cySales: number;
  cyUnits: number;
  inventoryUnits: number | null;
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
  "CP2081",
  "CT1081",
  "CT1730",
  "GDH1000",
  "GDH100",
  "GDH135",
  "GDH400",
  "G1092",
  "G1093",
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
  const [dashboardData, setDashboardData] = useState<DashboardData>({ records: [], images: [] });
  const [dashboardStatus, setDashboardStatus] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [navCompact, setNavCompact] = useState(false);

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
      setDashboardData({ records: [], images: [] });
      return;
    }

    const client = supabase;
    const customerId = selectedCustomerId;
    let isMounted = true;
    setDashboardStatus("Loading sales records...");

    async function loadDashboard() {
      const [recordsResult, imagesResult] = await Promise.all([
        fetchAllRecords(client, customerId),
        fetchProductImages(client, customerId),
      ]);

      if (!isMounted) return;

      if (recordsResult.error) {
        setDashboardStatus(recordsResult.error);
        setDashboardData({ records: [], images: [] });
        return;
      }

      const records = recordsResult.records;
      setDashboardData({ records, images: imagesResult.images });
      setSelectedPeriod((current) => current ?? defaultPeriodValue(records));
      setDashboardStatus("");
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
    () => topArtRows(periodRecords, ytdCurrentRecords, dashboardData.images),
    [dashboardData.images, periodRecords, ytdCurrentRecords],
  );
  const periodStyleStudy = useMemo(() => topStyleRows(periodRecords, comparisonRecords), [periodRecords, comparisonRecords]);
  const ytdStyleStudy = useMemo(() => topStyleRows(ytdCurrentRecords, ytdPriorRecords), [ytdCurrentRecords, ytdPriorRecords]);
  const allStyleRowsForPeriod = useMemo(() => allStyleRows(periodRecords), [periodRecords]);
  const allStyles = useMemo(() => allStyleRowsForPeriod.slice(0, 100), [allStyleRowsForPeriod]);
  const salesMix = useMemo(() => salesMixSlices(periodRecords), [periodRecords]);
  const inventorySnapshot = useMemo(() => inventorySnapshotForRecords(periodRecords), [periodRecords]);
  const bestDay = useMemo(() => bestSalesDay(periodRecords), [periodRecords]);
  const ytdLine = useMemo(() => ytdPoints(recordsForCustomer, periodEndMonth), [recordsForCustomer, periodEndMonth]);
  const lastUploaded = latestDate(recordsForCustomer);

  const brandOptions = useMemo(() => {
    const options = [...new Set(dashboardData.records.map(brandName))].sort();
    return ["All", ...options];
  }, [dashboardData.records]);

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

  async function createShareLink() {
    if (!supabase || !selectedCustomer || !user) return;

    setShareStatus("Generating share link...");
    setShareUrl("");

    const token = createReportToken();
    const title = `${selectedCustomer.name} ${selectedPeriodTitle} Sales Snapshot`;
    const payload: ReportSnapshotPayload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      accountName: selectedCustomer.name,
      brandFilter,
      periodMode: selectedPeriodKind === "month" ? "monthly" : "ytd",
      selectedMonth: periodEndMonth,
      periodTitle: selectedPeriodTitle,
      priorPeriodTitle,
      previousMonthTitle: priorPeriodTitle,
      lastUploaded,
      currentMetrics,
      priorMetrics,
      ytdLine,
      ytdInsights,
      inventorySnapshot,
      salesMix,
      bestDay: {
        date: bestDay.date,
        sales: bestDay.sales,
        units: bestDay.units,
        transactions: bestDay.transactions,
        dayCount: bestDay.dayCount,
        items: bestDay.items,
      },
      topStyles: ytdStyleStudy,
      styleStudyMonthly: periodStyleStudy,
      styleStudyYtd: ytdStyleStudy,
      topArt,
      allStyles,
    };

    const { error } = await supabase.from("report_snapshots").insert({
      token,
      title,
      customer_id: selectedCustomer.id,
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

  async function importFile(file: File | null) {
    if (!file || !supabase || !selectedCustomer || !user) return;

    setImportStatus(`Reading ${file.name}...`);
    try {
      const parsed = await parseSalesWorkbook(file, selectedCustomer.name);
      if (parsed.records.length === 0) {
        setImportStatus(`No importable records found. Skipped ${parsed.skippedCount} rows.`);
        return;
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
      setSelectedPeriod(null);
      setReloadKey((key) => key + 1);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Import failed.");
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
                  type="file"
                  onChange={(event) => {
                    void importFile(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </div>

          <div className="navSignOutField">
            <span>{user.email ?? "Signed in"}</span>
            <button className="ghostButton navSignOut" onClick={signOut}>
              Sign Out
            </button>
          </div>
          {(customerStatus || importStatus) ? (
            <p className="navMessage">{importStatus || customerStatus}</p>
          ) : null}
        </nav>

        <section className="dashboard">
          <header className="dashboardHeader">
            <div>
              <p className="eyebrow">Sales Snapshot</p>
              <h2>{selectedCustomer?.name ?? "Account"}</h2>
              <p className="muted">Track current sales, prior-year movement, product breadth, and top sellers.</p>
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

              <button className="shareButton" onClick={createShareLink} disabled={!periodRecords.length}>
                Share Report
              </button>
            </div>
          </header>

          {(shareStatus || shareUrl) ? (
            <div className="modalOverlay" role="presentation">
              <section className="shareModal" role="dialog" aria-modal="true" aria-labelledby="share-report-title">
                <button
                  aria-label="Close share report"
                  className="modalCloseButton"
                  onClick={() => {
                    setShareStatus("");
                    setShareUrl("");
                  }}
                >
                  X
                </button>
                <p className="eyebrow">Share Snapshot</p>
                <h3 id="share-report-title">Report link</h3>
                <p>{shareStatus}</p>
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
              <strong className={`changeBadge ${changeClass(currentMetrics.sales - priorMetrics.sales)}`}>
                {changeText(currentMetrics.sales, priorMetrics.sales)}
              </strong>
            </div>

            <div className="metricGrid four">
              <MetricCard label="Sales" value={currencyText(currentMetrics.sales)} />
              <MetricCard label="Transactions" value={numberText(currentMetrics.transactions)} />
              <MetricCard label="Units" value={numberText(currentMetrics.units)} />
              <MetricCard label="Last Year Sales" value={currencyText(priorMetrics.sales)} />
            </div>

            <div className="insightGrid">
              <SalesMixCard slices={salesMix} totalUnits={currentMetrics.units} />
              <ComparisonCard current={currentMetrics} prior={priorMetrics} selectedPeriod={selectedPeriodTitle} priorPeriod={priorPeriodTitle} />
              <BestDayCard bestDay={bestDay} periodTitle={selectedPeriodTitle} />
            </div>
          </section>

          {inventorySnapshot ? (
            <section className="sectionBlock inventorySection">
              <div className="sectionTitle">
                <div>
                  <h3>Inventory Snapshot</h3>
                  <p>Current on-hand inventory from the latest inventory data inside {selectedPeriodTitle}.</p>
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
                  {selectedPeriodTitle} Top 25 Total: {numberText(sum(topArt.map((row) => row.units)))} Units |{" "}
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
                      <span>Current Inv: {numberText(row.inventoryUnits)}</span>
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

function SalesMixCard({ slices, totalUnits }: { slices: SalesMixSlice[]; totalUnits: number }) {
  return (
    <article className="insightCard">
      <h4>Sales Mix Units</h4>
      <div className="mixStack">
        {slices.map((slice) => (
          <div className="mixRow" key={slice.name}>
            <div>
              <strong>{slice.name}</strong>
              <span>{numberText(slice.units)} units</span>
            </div>
            <div className="barTrack">
              <span style={{ width: `${Math.max(3, slice.percent)}%` }} />
            </div>
            <small>{slice.percent.toFixed(1)}%</small>
          </div>
        ))}
        {totalUnits === 0 ? <p className="muted">No unit data for this period.</p> : null}
      </div>
    </article>
  );
}

function ComparisonCard({
  current,
  prior,
  selectedPeriod,
  priorPeriod,
}: {
  current: MetricSet;
  prior: MetricSet;
  selectedPeriod: string;
  priorPeriod: string;
}) {
  const maxSales = Math.max(current.sales, prior.sales, 1);
  return (
    <article className="insightCard">
      <div className="cardHeading">
        <h4>Sales Comparison</h4>
        <strong className={changeClass(current.sales - prior.sales)}>{changeText(current.sales, prior.sales)}</strong>
      </div>
      <CompareBar label={selectedPeriod} value={current.sales} max={maxSales} />
      <CompareBar label={priorPeriod} value={prior.sales} max={maxSales} secondary />
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
            : `Based on current selling trends, available inventory would cover about ${snapshot.coverage.toFixed(1)} months at this pace.`}
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

function BestDayCard({ bestDay, periodTitle }: { bestDay: ReturnType<typeof bestSalesDay>; periodTitle: string }) {
  const maxUnits = Math.max(...bestDay.items.map((item) => item.units), 1);
  const hasDailySales = bestDay.dayCount > 1;
  return (
    <article className="insightCard">
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

function CompareBar({ label, value, max, secondary = false }: { label: string; value: number; max: number; secondary?: boolean }) {
  return (
    <div className="compareRow">
      <span>{label}</span>
      <div className={`barTrack ${secondary ? "secondary" : ""}`}>
        <span style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
      </div>
      <strong>{currencyText(value)}</strong>
    </div>
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
  const activeMonthCount = Math.max(1, lastActiveMonthIndex(currentValues, priorValues) + 1);
  const displayedCurrent = currentValues.slice(0, activeMonthCount);
  const displayedPrior = priorValues.slice(0, activeMonthCount);
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
    return series === "prior" ? y - 5.2 : y + 5.1;
  }
}

function padMonths(values: number[]) {
  return Array.from({ length: 12 }, (_, index) => values[index] ?? 0);
}

function lastActiveMonthIndex(current: number[], prior: number[]) {
  for (let index = 11; index >= 0; index -= 1) {
    if ((current[index] ?? 0) > 0 || (prior[index] ?? 0) > 0) return index;
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
      .select("id,customer_id,transaction_date,amount,units,product_class,master_style,color,size,catalog_color_name,style_number,raw_style_identifier,art_code,inventory_units")
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

function topArtRows(records: SalesRecord[], ytdRecords: SalesRecord[], images: ProductImage[]): TopArt[] {
  const ytdGroups = groupBy(ytdRecords, artKey);
  const imageLookup = imageLookupMaps(images);
  return groupedRows(records, artKey)
    .map(([key, group]) => {
      const first = group[0];
      const style = normalizedStyle(first);
      const artCode = clean(first.art_code) || "-";
      const color = colorName(first);
      const cyGroup = ytdGroups.get(key) ?? [];
      return {
        rank: 0,
        key,
        style,
        brand: brandName(first),
        styleName: clean(first.master_style) || "Unknown Style Name",
        color,
        artCode,
        sales: sum(group.map(amountValue)),
        units: sum(group.map((record) => record.units ?? 0)),
        transactions: group.length,
        cySales: sum(cyGroup.map(amountValue)),
        cyUnits: sum(cyGroup.map((record) => record.units ?? 0)),
        inventoryUnits: inventoryTotalForLatestSnapshot(group),
        imageUrl: findProductImageUrl(imageLookup, style, artCode, color),
      };
    })
    .sort(sortBySales)
    .slice(0, 25)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function storagePublicUrl(client: SupabaseClient, storagePath: string | null) {
  if (!storagePath) return null;
  return client.storage.from("product-images").getPublicUrl(storagePath).data.publicUrl;
}

function imageLookupMaps(images: ProductImage[]) {
  const exact = new Map<string, string>();
  const styleArt = new Map<string, Set<string>>();
  const art = new Map<string, Set<string>>();

  images.forEach((image) => {
    const url = image.resolved_url ?? image.image_url;
    if (!url) return;
    exact.set(imageKey(image.style_number, image.art_code, image.color), url);
    addToSetMap(styleArt, imageStyleArtKey(image.style_number, image.art_code), url);
    addToSetMap(art, compactImagePart(image.art_code), url);
  });

  return { exact, styleArt, art };
}

function findProductImageUrl(
  lookup: ReturnType<typeof imageLookupMaps>,
  style: string,
  artCode: string,
  color: string,
) {
  const exact = lookup.exact.get(imageKey(style, artCode, color));
  if (exact) return exact;

  const styleArt = oneUniqueValue(lookup.styleArt.get(imageStyleArtKey(style, artCode)));
  if (styleArt) return styleArt;

  return oneUniqueValue(lookup.art.get(compactImagePart(artCode)));
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string) {
  map.set(key, (map.get(key) ?? new Set()).add(value));
}

function oneUniqueValue(values: Set<string> | undefined) {
  return values?.size === 1 ? [...values][0] : null;
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
    prior.push(index <= lastMonth ? sum(recordsForPeriod(records, `${year - 1}-${suffix}`, "monthly").map(amountValue)) : 0);
  }
  return {
    current,
    prior,
    currentTotal: sum(current),
    priorTotal: sum(prior),
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

function breadthMetrics(records: SalesRecord[]) {
  return {
    styles: uniqueCount(records.map(normalizedStyle)),
    colors: uniqueCount(records.map(colorName)),
    artworks: uniqueCount(records.map((record) => clean(record.art_code))),
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

function brandName(record: SalesRecord) {
  const style = normalizedStyle(record);
  const classText = `${record.product_class ?? ""} ${record.master_style ?? ""}`.toUpperCase();
  if (classText.includes("GEAR") || classText.includes("COMFORT WASH")) return "Gear";
  if (GEAR_STYLE_PREFIXES.some((prefix) => style.startsWith(prefix))) return "Gear";
  return "Champion";
}

function audienceName(record: SalesRecord) {
  const text = `${record.product_class ?? ""} ${record.master_style ?? ""}`.toUpperCase();
  if (text.includes("YOUTH") || text.includes("INFANT") || text.includes("TODDLER")) return "Youth";
  if (text.includes("WOMEN") || text.includes("WMNS") || text.includes("W-S") || text.includes("LADY") || text.includes("LADIES")) {
    return "Women's";
  }
  return "Unisex";
}

function normalizedStyle(record: SalesRecord) {
  const raw = clean(record.style_number) || clean(record.raw_style_identifier) || "-";
  const upper = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const knownPrefix = KNOWN_STYLE_PREFIXES.find((prefix) => upper.startsWith(prefix));
  if (knownPrefix) return knownPrefix;
  return raw.toUpperCase().replace(/[-\s]+$/g, "") || "-";
}

function styleKey(record: SalesRecord) {
  return normalizedStyle(record);
}

function artKey(record: SalesRecord) {
  return [brandName(record), normalizedStyle(record), clean(record.art_code) || "-", colorName(record)].join("|");
}

function imageKey(style: string, artCode: string, color: string) {
  return [compactImagePart(style), compactImagePart(artCode), compactImagePart(color)].join("|");
}

function imageStyleArtKey(style: string, artCode: string) {
  return [compactImagePart(style), compactImagePart(artCode)].join("|");
}

function compactImagePart(value: string | null | undefined) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function colorName(record: SalesRecord) {
  return clean(record.catalog_color_name) || clean(record.color) || "-";
}

function monthKey(value: string | null) {
  return value?.slice(0, 7) ?? null;
}

function amountValue(record: SalesRecord) {
  return Number(record.amount ?? 0);
}

function inventorySnapshotForRecords(records: SalesRecord[]): InventorySnapshot {
  const snapshotRecords = latestInventoryRecords(records);
  if (!snapshotRecords.length) return null;
  const totalUnits = sum(snapshotRecords.map((record) => record.inventory_units ?? 0));
  const soldUnits = sum(records.map((record) => record.units ?? 0));
  return {
    date: snapshotRecords[0].transaction_date,
    totalUnits,
    styles: uniqueCount(snapshotRecords.map(styleKey)),
    artworks: uniqueCount(snapshotRecords.map((record) => clean(record.art_code))),
    coverage: soldUnits ? totalUnits / soldUnits : null,
    byBrand: inventoryByBrand(snapshotRecords),
    topStyles: topInventoryStyles(snapshotRecords),
  };
}

function inventoryTotalForLatestSnapshot(records: SalesRecord[]) {
  const snapshotRecords = latestInventoryRecords(records);
  if (!snapshotRecords.length) return null;
  return sum(snapshotRecords.map((record) => record.inventory_units ?? 0));
}

function latestInventoryRecords(records: SalesRecord[]) {
  const inventoryRecords = records.filter((record) => record.inventory_units != null);
  const latestInventoryDate = inventoryRecords.map((record) => record.transaction_date).sort().at(-1);
  if (!latestInventoryDate) return [];
  return inventoryRecords.filter((record) => record.transaction_date === latestInventoryDate);
}

function inventoryByBrand(records: SalesRecord[]) {
  return groupedRows(records, brandName)
    .map(([brand, group]) => ({
      brand,
      units: sum(group.map((record) => record.inventory_units ?? 0)),
    }))
    .sort((left, right) => right.units - left.units || left.brand.localeCompare(right.brand));
}

function topInventoryStyles(records: SalesRecord[]) {
  return groupedRows(records, styleKey)
    .map(([style, group]) => ({
      style,
      brand: brandName(group[0]),
      units: sum(group.map((record) => record.inventory_units ?? 0)),
      artworks: uniqueCount(group.map((record) => clean(record.art_code))),
    }))
    .filter((row) => row.units > 0)
    .sort((left, right) => right.units - left.units || left.style.localeCompare(right.style))
    .slice(0, 5);
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

function changeText(current: number, prior: number) {
  if (!prior) return current ? "New" : "-";
  const percent = ((current - prior) / prior) * 100;
  return `${percent >= 0 ? "Up" : "Down"} ${Math.abs(percent).toFixed(1)}%`;
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
    .select("transaction_date,amount,units,master_style,color,catalog_color_name,style_number,art_code,size,raw_style_identifier")
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
  | "master_style"
  | "color"
  | "catalog_color_name"
  | "style_number"
  | "art_code"
  | "size"
  | "raw_style_identifier"
>;

function recordKey(record: ParsedSalesRecord | SalesRecordForDuplicateCheck) {
  return [
    record.transaction_date,
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
  return (value ?? "").trim().toUpperCase();
}
