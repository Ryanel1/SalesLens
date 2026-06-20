import { createClient } from "@supabase/supabase-js";
import { currencyText, dateText, monthText, numberText, wholeCurrencyText } from "@/lib/formatters";
import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  isReportSnapshotBundlePayload,
  isShareSnapshotPayload,
  type ReportSnapshotBundlePayload,
  type ReportSnapshotPayload,
  type ReportSnapshotRecord,
  type SnapshotBestDay,
  type SnapshotInventory,
  type SnapshotInventoryLine,
  type SnapshotMetricSet,
  type SnapshotMonthlyDrivers,
  type SnapshotTopArt,
  type SnapshotWeeklyScorecardRow,
  type SnapshotYtdInsights,
} from "@/lib/reportSnapshot";
import { StyleStudyTabs } from "./StyleStudyTabs";

export const dynamic = "force-dynamic";

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const snapshot = await loadSnapshot(token);

  if (!snapshot) {
    return (
      <main className="publicShell">
        <section className="publicEmpty">
          <p className="eyebrow">SalesLens Share</p>
          <h1>Report link not found.</h1>
          <p>This report may have expired, been disabled, or the link may be incorrect.</p>
        </section>
      </main>
    );
  }

  const payload = snapshot.payload;

  if (isReportSnapshotBundlePayload(payload)) {
    return <SharedReportBundle payload={payload} />;
  }

  return <SharedAccountReport payload={payload} />;
}

function SharedReportBundle({ payload }: { payload: ReportSnapshotBundlePayload }) {
  return (
    <main className="publicShell accountThemeDefault">
      <section className="publicReport publicBundleReport" id="saleslens-report-capture">
        <div className="accountReportSwitcher">
          {payload.reports.map((report, index) => (
            <input
              aria-label={`Show ${report.accountName}`}
              defaultChecked={index === 0}
              id={`account-report-${index}`}
              key={`input-${report.accountName}`}
              name="account-report-switcher"
              type="radio"
            />
          ))}
          <header className="dashboardHeader publicDashboardHeader bundleDashboardHeader">
            <div>
              <div className="navBrand publicShareBrand">
                <h1>SalesLens</h1>
                <p>by Lester Sales</p>
              </div>
              <h1>Account Review</h1>
              <p className="muted">Toggle between accounts to review the same snapshot fields across the full SalesLens book.</p>
            </div>

            <aside className="publicHeaderAside">
              <div className="publicContactCard">
                <span>Sales Rep: Ryan Lester</span>
                <span>Phone: (502) 689-7374</span>
                <span>Email: ryanlestersells@gmail.com</span>
                <span>Website: www.lestersales.net</span>
              </div>
              <div className="publicContextCard">
                <div>
                  <span>Brand/Class</span>
                  <strong>{payload.brandFilter}</strong>
                </div>
                <div>
                  <span>Period</span>
                  <strong>{payload.periodTitle}</strong>
                </div>
              </div>
            </aside>

            <div className="accountReportTabs" role="tablist" aria-label="Shared account reports">
              {payload.reports.map((report, index) => (
                <label htmlFor={`account-report-${index}`} key={report.accountName}>
                  {report.accountName}
                </label>
              ))}
            </div>
          </header>
          <div className="accountReportPanels">
            {payload.reports.map((report) => (
              <div className={`accountReportPanel ${accountThemeClass(report.accountName)}`} key={report.accountName}>
                <SharedAccountReport payload={report} embedded />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function SharedAccountReport({ payload, embedded = false }: { payload: ReportSnapshotPayload; embedded?: boolean }) {
  const Shell = embedded ? "div" : "main";

  return (
    <Shell className={embedded ? "" : `publicShell ${accountThemeClass(payload.accountName)}`}>
      <section className={embedded ? "publicAccountReport" : "publicReport"} id={embedded ? undefined : "saleslens-report-capture"}>
        {!embedded ? (
          <header className="dashboardHeader publicDashboardHeader">
            <div>
              <div className="navBrand publicShareBrand">
                <h1>SalesLens</h1>
                <p>by Lester Sales</p>
              </div>
              <h1>{payload.accountName}</h1>
              <p className="muted">Compare YTD pace, monthly sales movement, inventory signals, and top-performing styles and art.</p>
            </div>

            <aside className="publicHeaderAside">
              <div className="publicContactCard">
                <span>Sales Rep: Ryan Lester</span>
                <span>Phone: (502) 689-7374</span>
                <span>Email: ryanlestersells@gmail.com</span>
                <span>Website: www.lestersales.net</span>
              </div>
              <div className="publicContextCard">
                <div>
                  <span>Brand/Class</span>
                  <strong>{payload.brandFilter}</strong>
                </div>
                <div>
                  <span>Period</span>
                  <strong>{payload.periodTitle}</strong>
                </div>
              </div>
            </aside>
          </header>
        ) : null}

        <ReportSection
          title={payload.periodMode === "ytd" ? "Year Scorecard" : "YTD Scorecard"}
          subtitle={`${payload.periodTitle} compared with the same date range last year.`}
          aside={changeText(payload.ytdLine.currentTotal, payload.ytdLine.priorTotal)}
          asideTone={payload.ytdLine.currentTotal - payload.ytdLine.priorTotal}
        >
          <div className="ytdTrackerLayout">
            <StaticLineChart payload={payload} />

            <div className="ytdTrackerTiles">
              <MetricCard label="Current YTD" value={currencyText(payload.ytdLine.currentTotal)} />
              <MetricCard label="Prior YTD" value={currencyText(payload.ytdLine.priorTotal)} />
              <MetricCard
                label="Total Change"
                value={currencyText(payload.ytdLine.currentTotal - payload.ytdLine.priorTotal)}
                tone={payload.ytdLine.currentTotal - payload.ytdLine.priorTotal}
              />
              {payload.ytdInsights ? (
                <>
                  <YtdInsightCard
                    label="Avg Monthly Sales"
                    value={currencyText(payload.ytdInsights.averageMonthlySales)}
                    detail={`${currencyText(payload.ytdInsights.priorAverageMonthlySales)} LY`}
                    tone={payload.ytdInsights.averageMonthlySales - payload.ytdInsights.priorAverageMonthlySales}
                  />
                  <ProductBreadthCard insights={payload.ytdInsights} />
                </>
              ) : null}
            </div>
          </div>
        </ReportSection>

        <ReportSection
          title={payload.periodMode === "ytd" ? "Selected Year Scorecard" : "Monthly Scorecard"}
          subtitle={`${payload.periodTitle} compared with ${payload.priorPeriodTitle}.`}
        >
          {payload.monthlyDrivers ? (
            <SalesDriverGrid
              bestDay={payload.bestDay}
              current={payload.currentMetrics}
              drivers={payload.monthlyDrivers}
              periodTitle={payload.periodTitle}
              prior={payload.priorMetrics}
            />
          ) : null}
        </ReportSection>

        {payload.periodMode !== "ytd" && payload.weeklyScorecards?.length ? (
          <ReportSection
            title="Weekly Scorecard"
            subtitle={`Monday-Sunday sales weeks inside ${payload.periodTitle}, compared with the same weekday range last year.`}
          >
            <WeeklyScorecard rows={payload.weeklyScorecards} />
          </ReportSection>
        ) : null}

        <ReportSection title="Style Comparison" subtitle="Style-level units, sales, colors, and artwork breadth.">
          <StyleStudyTabs
            monthlyStyles={payload.styleStudyMonthly ?? payload.topStyles}
            ytdStyles={payload.styleStudyYtd ?? payload.topStyles}
            currentPeriodTitle={payload.periodTitle}
            previousMonthTitle={payload.previousMonthTitle ?? "last month"}
            currentLabel={payload.periodMode === "monthly" ? "Current Month" : "Selected Year"}
            currentCompareLabel="LY"
          />
        </ReportSection>

        <ReportSection
          title="Top Performing Styles"
          subtitle={`${payload.periodTitle} Top 30 by ${payload.topArtSort === "dollars" ? "Dollars" : "Units"}: ${numberText(sum(payload.topArt.map((row) => row.units)))} Units | ${currencyText(sum(payload.topArt.map((row) => row.sales)))}`}
        >
          <div className="artGrid">
            {payload.topArt.map((row) => (
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
                  <span>{payload.periodMode === "monthly" ? "Month" : "Year"}: {numberText(row.units)} Units | {wholeCurrencyText(row.sales)}</span>
                  {payload.periodMode === "monthly" ? (
                    <span>YTD: {numberText(row.cyUnits)} Units | {wholeCurrencyText(row.cySales)}</span>
                  ) : null}
                  {row.inventoryUnits != null ? (
                    <span>{inventoryLabel(row)}</span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </ReportSection>

        {payload.inventorySnapshot ? (
          <ReportSection
            title="Inventory Snapshot"
            subtitle="Current on-hand inventory from the latest available inventory data."
            aside={dateText(payload.inventorySnapshot.date)}
          >
            <InventoryCard snapshot={payload.inventorySnapshot} />
          </ReportSection>
        ) : null}

        {payload.inventoryTracker?.length ? (
          <ReportSection
            title="Inventory Tracker"
            subtitle={`${payload.inventoryTrackerSort === "lowest" ? "Lowest" : "Highest"} ${numberText(payload.inventoryTracker.length)} current on-hand items with 5+ units | ${numberText(sum(payload.inventoryTracker.map((row) => row.inventoryUnits)))} Units`}
          >
            <div className="artGrid">
              {payload.inventoryTracker.map((row) => (
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
                    <span>YTD Sold: {numberText(row.ytdUnits ?? 0)} Units</span>
                  </div>
                </article>
              ))}
            </div>
          </ReportSection>
        ) : null}

      </section>
    </Shell>
  );
}

async function loadSnapshot(token: string): Promise<ReportSnapshotRecord | null> {
  const config = getSupabaseConfig();
  if (!config) return null;

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data, error } = await supabase.rpc("get_report_snapshot", { report_token: token }).single();
  const row = data as {
    token: string;
    title: string;
    payload: unknown;
    created_at: string;
    expires_at: string | null;
  } | null;

  if (error || !row || !isShareSnapshotPayload(row.payload)) return null;

  return {
    token: row.token,
    title: row.title,
    payload: row.payload,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

function ReportSection({
  title,
  subtitle,
  aside,
  asideTone,
  children,
}: {
  title: string;
  subtitle: string;
  aside?: string;
  asideTone?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="sectionBlock">
      <div className="sectionTitle">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {aside ? <strong className={`changeBadge ${asideTone == null ? "" : changeClass(asideTone)}`}>{aside}</strong> : null}
      </div>
      {children}
    </section>
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

function YtdInsightCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: number }) {
  return (
    <article className="ytdInsightCard">
      <p>{label}</p>
      <strong>{value}</strong>
      <span className={changeClass(tone)}>{detail}</span>
    </article>
  );
}

function ProductBreadthCard({ insights }: { insights: SnapshotYtdInsights }) {
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
  bestDay: SnapshotBestDay;
  current: SnapshotMetricSet;
  prior: SnapshotMetricSet;
  drivers: SnapshotMonthlyDrivers;
  periodTitle: string;
}) {
  const avgSalePerUnit = drivers.avgSalePerUnit ?? (current.units ? current.sales / current.units : 0);
  const priorAvgSalePerUnit = drivers.priorAvgSalePerUnit ?? (prior.units ? prior.sales / prior.units : 0);
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
          `Avg $ / unit: ${currencyText(avgSalePerUnit)} vs ${currencyText(priorAvgSalePerUnit)} LY`,
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

function WeeklyScorecard({ rows }: { rows: SnapshotWeeklyScorecardRow[] }) {
  return (
    <div className="weeklyScorecardList">
      {rows.map((row) => {
        const salesDelta = row.current.sales - row.prior.sales;
        const unitsDelta = row.current.units - row.prior.units;
        const transactionDelta = row.current.transactions - row.prior.transactions;
        const topProducts = row.topItems?.length ? row.topItems : row.topItem ? [row.topItem] : [];
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
              {topProducts.length ? (
                <div className="weeklyTopProductList">
                  {topProducts.map((item) => (
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

function TopSalesItemsCard({ bestDay, periodTitle }: { bestDay: SnapshotBestDay; periodTitle: string }) {
  const maxUnits = Math.max(...bestDay.items.map((item) => item.units), 1);
  const hasDailySales = (bestDay.dayCount ?? 0) > 1;
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
        <div className="bestRow" key={`${item.rank}-${item.style}-${item.artCode}`}>
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

function inventoryLabel(row: Pick<SnapshotTopArt, "inventoryScope" | "inventoryUnits">) {
  if (row.inventoryUnits == null) return "";
  if (row.inventoryScope === "styleArt") return `Style/Art Inv: ${numberText(row.inventoryUnits)} total`;
  return `Current Inv: ${numberText(row.inventoryUnits)}`;
}

function InventoryCard({ snapshot }: { snapshot: SnapshotInventory }) {
  if (!snapshot) return null;
  const position = snapshot.position ?? inventoryPositionFallback(snapshot.coverage);
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
      <InventoryPositionCard position={position} />
      {snapshot.line ? <InventoryLineChart line={snapshot.line} /> : null}
    </article>
  );
}

function InventoryPositionCard({
  position,
}: {
  position: NonNullable<NonNullable<SnapshotInventory>["position"]>;
}) {
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

function InventoryLineChart({ line }: { line: SnapshotInventoryLine }) {
  return (
    <StaticLineChartBase
      ariaLabel="Inventory units on hand by month"
      className="inventoryTrendChart"
      current={line.current}
      currentLabel={String(line.currentYear)}
      prior={line.prior}
      priorLabel={String(line.priorYear)}
    />
  );
}

function StaticLineChart({ payload }: { payload: ReportSnapshotPayload }) {
  return (
    <StaticLineChartBase
      current={payload.ytdLine.current}
      currentLabel="Current"
      prior={payload.ytdLine.prior}
      priorLabel="Last Year"
    />
  );
}

function StaticLineChartBase({
  ariaLabel = "Comparative sales by month",
  className = "",
  current,
  currentLabel,
  prior,
  priorLabel,
}: {
  ariaLabel?: string;
  className?: string;
  current: Array<number | null>;
  currentLabel: string;
  prior: Array<number | null>;
  priorLabel: string;
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
        <span><i className="dot current" />{currentLabel}</span>
        <span><i className="dot prior" />{priorLabel}</span>
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

function accountThemeClass(name?: string | null) {
  const normalized = (name ?? "").toLowerCase();
  if (normalized.includes("rebel")) return "accountThemeRebelRags";
  if (normalized.includes("volshop") || normalized.includes("vol shop")) return "accountThemeVolshop";
  return "accountThemeDefault";
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function countText(value: number, singular: string, plural: string) {
  return `${numberText(value)} ${value === 1 ? singular : plural}`;
}

function inventoryPositionFallback(
  coverage: number | null | undefined,
): NonNullable<NonNullable<SnapshotInventory>["position"]> {
  const score = coverage == null ? 50 : Math.min(95, Math.max(5, Math.round(50 + ((coverage - 3.4) / 3.4) * 42)));
  const label = score < 40 ? "Lean" : score > 60 ? "Heavy" : "Balanced";
  return {
    score,
    label,
    headline: label === "Balanced"
      ? "Inventory looks balanced against current pace and seasonal demand."
      : label === "Lean"
        ? "Inventory is leaning light for the demand window ahead."
        : "Inventory is carrying heavier than the current selling pace.",
    detail: coverage == null
      ? "Current stock cannot be matched cleanly to recent selling pace yet."
      : `Current stock covers about ${coverage.toFixed(1)} months at the normalized sales pace.`,
    comparison: "Prior-year same-month inventory context was not saved with this older snapshot.",
  };
}
