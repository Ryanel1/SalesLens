"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { currencyText, dateText, monthText, numberText } from "@/lib/formatters";
import type { ReportSnapshotPayload } from "@/lib/reportSnapshot";
import type { Customer } from "@/lib/types";

type PeriodMode = "monthly" | "ytd";

type SalesRecord = {
  id: string;
  customer_id: string;
  transaction_date: string;
  amount: number | string | null;
  units: number | null;
  product_class: string | null;
  master_style: string | null;
  color: string | null;
  catalog_color_name: string | null;
  style_number: string | null;
  raw_style_identifier: string | null;
  art_code: string | null;
};

type ProductImage = {
  style_number: string;
  art_code: string;
  color: string;
  image_url: string | null;
  storage_path: string | null;
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

type SalesMixSlice = {
  name: string;
  units: number;
  percent: number;
};

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
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState("All");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("monthly");
  const [dashboardData, setDashboardData] = useState<DashboardData>({ records: [], images: [] });
  const [dashboardStatus, setDashboardStatus] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [shareUrl, setShareUrl] = useState("");

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
      setSelectedMonth((current) => current ?? availableMonths(records)[0] ?? null);
      setDashboardStatus("");
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [supabase, selectedCustomerId]);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const months = useMemo(() => availableMonths(dashboardData.records), [dashboardData.records]);
  const selectedMonthValue = selectedMonth ?? months[0] ?? null;
  const selectedYear = selectedMonthValue ? Number(selectedMonthValue.slice(0, 4)) : null;
  const priorYearMonth = selectedMonthValue && selectedYear ? `${selectedYear - 1}${selectedMonthValue.slice(4)}` : null;

  const recordsForCustomer = useMemo(() => {
    return dashboardData.records.filter((record) => brandFilter === "All" || brandName(record) === brandFilter);
  }, [brandFilter, dashboardData.records]);

  const periodRecords = useMemo(() => {
    if (!selectedMonthValue) return [];
    return recordsForPeriod(recordsForCustomer, selectedMonthValue, periodMode);
  }, [periodMode, recordsForCustomer, selectedMonthValue]);

  const priorPeriodRecords = useMemo(() => {
    if (!priorYearMonth) return [];
    return recordsForPeriod(recordsForCustomer, priorYearMonth, periodMode);
  }, [periodMode, priorYearMonth, recordsForCustomer]);

  const currentMetrics = useMemo(() => metricSet(periodRecords), [periodRecords]);
  const priorMetrics = useMemo(() => metricSet(priorPeriodRecords), [priorPeriodRecords]);
  const totalRecordsMetrics = useMemo(() => metricSet(recordsForCustomer), [recordsForCustomer]);
  const topArt = useMemo(
    () => topArtRows(periodRecords, currentYearRecords(recordsForCustomer, selectedMonthValue), dashboardData.images),
    [dashboardData.images, periodRecords, recordsForCustomer, selectedMonthValue],
  );
  const topStyles = useMemo(() => topStyleRows(periodRecords, priorPeriodRecords), [periodRecords, priorPeriodRecords]);
  const allStyles = useMemo(() => allStyleRows(periodRecords), [periodRecords]);
  const salesMix = useMemo(() => salesMixSlices(periodRecords), [periodRecords]);
  const bestDay = useMemo(() => bestSalesDay(periodRecords), [periodRecords]);
  const ytdLine = useMemo(() => ytdPoints(recordsForCustomer, selectedMonthValue), [recordsForCustomer, selectedMonthValue]);
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
    const title = `${selectedCustomer.name} ${periodMode === "monthly" ? monthText(selectedMonthValue) : ytdTitle(selectedMonthValue)}`;
    const payload: ReportSnapshotPayload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      accountName: selectedCustomer.name,
      brandFilter,
      periodMode,
      selectedMonth: selectedMonthValue,
      periodTitle: periodMode === "monthly" ? monthText(selectedMonthValue) : ytdTitle(selectedMonthValue),
      priorPeriodTitle: periodMode === "monthly" ? monthText(priorYearMonth) : ytdTitle(priorYearMonth),
      lastUploaded,
      currentMetrics,
      priorMetrics,
      ytdLine,
      salesMix,
      bestDay: {
        date: bestDay.date,
        sales: bestDay.sales,
        units: bestDay.units,
        transactions: bestDay.transactions,
        items: bestDay.items,
      },
      topStyles,
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

  if (user) {
    return (
      <main className="appShell">
        <aside className="sidebar">
          <div>
            <p className="eyebrow">Lester Sales</p>
            <h1>SalesLens</h1>
          </div>

          <nav className="accountStack" aria-label="Accounts">
            {customerStatus ? <p className="muted">{customerStatus}</p> : null}
            {customers.map((customer) => (
              <button
                className={customer.id === selectedCustomerId ? "accountButton active" : "accountButton"}
                key={customer.id}
                onClick={() => {
                  setSelectedCustomerId(customer.id);
                  setSelectedMonth(null);
                  setBrandFilter("All");
                }}
              >
                {customer.name}
              </button>
            ))}
          </nav>

          <div className="sidebarFooter">
            <p>Last Date Uploaded</p>
            <strong>{dateText(lastUploaded)}</strong>
            <button className="ghostButton" onClick={signOut}>
              Sign Out
            </button>
          </div>
        </aside>

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
                Month
                <select
                  value={selectedMonthValue ?? ""}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                >
                  {months.map((month) => (
                    <option key={month} value={month}>
                      {monthText(month)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="segmentedControl" aria-label="Period">
                <button className={periodMode === "monthly" ? "active" : ""} onClick={() => setPeriodMode("monthly")}>
                  Monthly
                </button>
                <button className={periodMode === "ytd" ? "active" : ""} onClick={() => setPeriodMode("ytd")}>
                  Jan 1-YTD
                </button>
              </div>

              <button className="shareButton" onClick={createShareLink} disabled={!periodRecords.length}>
                Share Report
              </button>
            </div>
          </header>

          {(shareStatus || shareUrl) ? (
            <section className="sharePanel">
              <strong>{shareStatus}</strong>
              {shareUrl ? (
                <div>
                  <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
                  <button className="ghostButton" onClick={() => navigator.clipboard?.writeText(shareUrl)}>
                    Copy
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="overviewStrip" aria-label="Current dashboard context">
            <article>
              <span>Selected Period</span>
              <strong>{periodMode === "monthly" ? monthText(selectedMonthValue) : ytdTitle(selectedMonthValue)}</strong>
            </article>
            <article>
              <span>Brand/Class</span>
              <strong>{brandFilter}</strong>
            </article>
            <article>
              <span>Loaded Rows</span>
              <strong>{numberText(totalRecordsMetrics.transactions)}</strong>
            </article>
            <article>
              <span>Last Date Uploaded</span>
              <strong>{dateText(lastUploaded)}</strong>
            </article>
          </section>

          {dashboardStatus ? <section className="notice">{dashboardStatus}</section> : null}
          {!dashboardStatus && periodRecords.length === 0 ? (
            <section className="notice">No records match the current account, month, and brand/class filters.</section>
          ) : null}

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>Year-To-Date Sales Tracker</h3>
                <p>{ytdTitle(selectedMonthValue)} compared with the same date range last year.</p>
              </div>
              <strong className={changeClass(ytdLine.currentTotal - ytdLine.priorTotal)}>
                {changeText(ytdLine.currentTotal, ytdLine.priorTotal)}
              </strong>
            </div>

            <div className="metricGrid three">
              <MetricCard label={selectedYear ? `${selectedYear} YTD` : "Current YTD"} value={currencyText(ytdLine.currentTotal)} />
              <MetricCard label={selectedYear ? `${selectedYear - 1} YTD` : "Prior YTD"} value={currencyText(ytdLine.priorTotal)} />
              <MetricCard label="Total Change" value={currencyText(ytdLine.currentTotal - ytdLine.priorTotal)} tone={ytdLine.currentTotal - ytdLine.priorTotal} />
            </div>

            <MiniLineChart current={ytdLine.current} prior={ytdLine.prior} currentYear={selectedYear} />
          </section>

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>Month Summary</h3>
                <p>{periodMode === "monthly" ? monthText(selectedMonthValue) : ytdTitle(selectedMonthValue)}</p>
              </div>
              <strong className={changeClass(currentMetrics.sales - priorMetrics.sales)}>
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
              <ComparisonCard current={currentMetrics} prior={priorMetrics} selectedMonth={selectedMonthValue} priorMonth={priorYearMonth} />
              <BestDayCard bestDay={bestDay} />
            </div>
          </section>

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>Top 10 Styles vs Last Year</h3>
                <p>Style-level units, sales, colors, and artwork breadth.</p>
              </div>
            </div>
            <div className="styleComparisonGrid">
              {topStyles.map((style) => (
                <StyleComparisonCard key={style.style} style={style} />
              ))}
            </div>
          </section>

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>Top 25 by Art</h3>
                <p>
                  Top 25 Total: {numberText(sum(topArt.map((row) => row.units)))} Units |{" "}
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
                    <span>{numberText(row.units)} Units | {currencyText(row.sales)}</span>
                    <span>CY: {numberText(row.cyUnits)} | {currencyText(row.cySales)}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="sectionBlock">
            <div className="sectionTitle">
              <div>
                <h3>All Styles Sold</h3>
                <p>{numberText(allStyles.length)} styles for the selected period.</p>
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
            Total loaded for this account/filter: {numberText(totalRecordsMetrics.transactions)} rows,{" "}
            {numberText(totalRecordsMetrics.units)} units, {currencyText(totalRecordsMetrics.sales)}.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="loginShell">
      <section className="loginPanel">
        <p className="eyebrow">Private Sales Dashboard</p>
        <h1>SalesLens</h1>
        <p className="intro">Sign in to view sales summaries, compare prior-year performance, and export reports.</p>

        <label htmlFor="email">Email</label>
        <input
          autoComplete="email"
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="ryanlestersells@gmail.com"
        />

        <label htmlFor="password">Password</label>
        <div className="loginRow">
          <input
            autoComplete="current-password"
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
          />
          <button onClick={signIn} disabled={!email || !password}>
            Sign In
          </button>
        </div>
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
  selectedMonth,
  priorMonth,
}: {
  current: MetricSet;
  prior: MetricSet;
  selectedMonth: string | null;
  priorMonth: string | null;
}) {
  const maxSales = Math.max(current.sales, prior.sales, 1);
  return (
    <article className="insightCard">
      <div className="cardHeading">
        <h4>Sales Comparison</h4>
        <strong className={changeClass(current.sales - prior.sales)}>{changeText(current.sales, prior.sales)}</strong>
      </div>
      <CompareBar label={monthText(selectedMonth)} value={current.sales} max={maxSales} />
      <CompareBar label={monthText(priorMonth)} value={prior.sales} max={maxSales} secondary />
    </article>
  );
}

function BestDayCard({ bestDay }: { bestDay: ReturnType<typeof bestSalesDay> }) {
  const maxUnits = Math.max(...bestDay.items.map((item) => item.units), 1);
  return (
    <article className="insightCard">
      <div className="cardHeading">
        <h4>Best Sales Day</h4>
        <strong>{dateText(bestDay.date)}</strong>
      </div>
      <p className="compactLine">
        {currencyText(bestDay.sales)} | {numberText(bestDay.units)} units | {numberText(bestDay.transactions)} transactions
      </p>
      {bestDay.items.map((item) => (
        <div className="bestRow" key={`${item.style}-${item.artCode}-${item.color}`}>
          <strong>#{item.rank} {item.style}</strong>
          <span className="barTrack"><span style={{ width: `${(item.units / maxUnits) * 100}%` }} /></span>
          <small>{numberText(item.units)} | {currencyText(item.sales)}</small>
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

function StyleComparisonCard({ style }: { style: TopStyle }) {
  const maxUnits = Math.max(style.units, style.priorUnits, 1);
  return (
    <article className="styleCompareCard">
      <div className="styleCompareTop">
        <strong>#{style.rank} {style.style}</strong>
        <span>{style.brand}</span>
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
        | LY:{" "}
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
        <CompareUnitBar label="LY" value={style.priorUnits} max={maxUnits} secondary />
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
  const maxValue = Math.max(...current, ...prior, 1);
  const points = (values: number[]) =>
    values
      .map((value, index) => {
        const x = values.length === 1 ? 50 : 6 + (index / (values.length - 1)) * 88;
        const y = 86 - (value / maxValue) * 70;
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <div className="lineCard">
      <div className="lineLegend">
        <span><i className="dot current" />{currentYear ?? "CY"}</span>
        <span><i className="dot prior" />{currentYear ? currentYear - 1 : "LY"}</span>
      </div>
      <svg viewBox="0 0 100 92" preserveAspectRatio="none" role="img" aria-label="YTD sales line chart">
        <line x1="6" x2="94" y1="86" y2="86" />
        <polyline points={points(prior)} className="priorLine" />
        <polyline points={points(current)} className="currentLine" />
      </svg>
    </div>
  );
}

async function fetchAllRecords(client: SupabaseClient, customerId: string) {
  const records: SalesRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("sales_records")
      .select("id,customer_id,transaction_date,amount,units,product_class,master_style,color,catalog_color_name,style_number,raw_style_identifier,art_code")
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
  return { images: (data ?? []) as ProductImage[] };
}

function availableMonths(records: SalesRecord[]) {
  return [...new Set(records.map((record) => monthKey(record.transaction_date)).filter((month): month is string => Boolean(month)))]
    .sort()
    .reverse();
}

function recordsForPeriod(records: SalesRecord[], month: string, periodMode: PeriodMode) {
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
  const imageMap = new Map(images.map((image) => [imageKey(image.style_number, image.art_code, image.color), image.image_url]));
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
        imageUrl: imageMap.get(imageKey(style, artCode, color)) ?? null,
      };
    })
    .sort(sortBySales)
    .slice(0, 25)
    .map((row, index) => ({ ...row, rank: index + 1 }));
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
  for (let index = 1; index <= lastMonth; index += 1) {
    const suffix = String(index).padStart(2, "0");
    current.push(sum(recordsForPeriod(records, `${year}-${suffix}`, "ytd").map(amountValue)));
    prior.push(sum(recordsForPeriod(records, `${year - 1}-${suffix}`, "ytd").map(amountValue)));
  }
  return {
    current,
    prior,
    currentTotal: current.at(-1) ?? 0,
    priorTotal: prior.at(-1) ?? 0,
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
  return [clean(style).toUpperCase(), clean(artCode).toUpperCase(), clean(color).toUpperCase()].join("|");
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

function latestDate(records: SalesRecord[]) {
  return records.map((record) => record.transaction_date).sort().at(-1) ?? null;
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
