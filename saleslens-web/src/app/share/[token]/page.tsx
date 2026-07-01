import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import { ReportHeroHeader, accountThemeClass } from "@/components/ReportHeroHeader";
import { currencyText, dateText, decimalText, monthText, numberText } from "@/lib/formatters";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { SharedProductGallery, type SharedProductGalleryItem } from "./SharedProductGallery";
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

export const dynamic = "force-dynamic";

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
  const performanceProductGalleryRows = sharedPerformanceProductGalleryRows(payload);
  const inventoryProductGalleryRows = sharedInventoryProductGalleryRows(payload);

  return (
    <Shell className={embedded ? "" : `publicShell ${accountThemeClass(payload.accountName)}`}>
      <section className={embedded ? "publicAccountReport" : "publicReport"} id={embedded ? undefined : "saleslens-report-capture"}>
        <ReportHeroHeader
          accountName={payload.accountName}
          comparisonDetail={payload.currentMetrics.sales || payload.priorMetrics.sales ? signedCurrencyText(payload.currentMetrics.sales - payload.priorMetrics.sales) : ""}
          comparisonLabel="Vs Last Year"
          comparisonValue={payload.currentMetrics.sales || payload.priorMetrics.sales ? changeText(payload.currentMetrics.sales, payload.priorMetrics.sales) : "Confirmed zero"}
          currentSalesDetail={payload.periodTitle}
          currentSalesLabel="Current Sales"
          currentSalesValue={currencyText(payload.currentMetrics.sales)}
          periodPillLabel={shareHeroPeriodLabel(payload)}
          priorDetail={payload.priorPeriodTitle}
          scoreAriaLabel={`${payload.periodTitle} sales snapshot`}
          scoreTone={changeClass(payload.currentMetrics.sales - payload.priorMetrics.sales)}
          unitsDetail={`${numberText(payload.priorMetrics.units)} LY`}
          unitsLabel="Units"
          unitsValue={numberText(payload.currentMetrics.units)}
        />

        <ReportSection
          title={payload.periodMode === "ytd" ? "Year Scorecard" : "YTD Scorecard"}
        >
          <div className="ytdTrackerLayout">
            <StaticLineChart payload={payload} />

            <div className="ytdTrackerTiles">
              <MetricCard label="Current YTD" value={currencyText(payload.ytdLine.currentTotal)} />
              <MetricCard label="Prior YTD" value={currencyText(payload.ytdLine.priorTotal)} />
              <MetricCard
                label="Total Change"
                value={signedCurrencyText(payload.ytdLine.currentTotal - payload.ytdLine.priorTotal)}
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
        >
          {payload.monthlyDrivers ? (
            <SalesDriverGrid
              current={payload.currentMetrics}
              drivers={payload.monthlyDrivers}
              periodTitle={payload.periodTitle}
              priorPeriodTitle={payload.priorPeriodTitle}
              prior={payload.priorMetrics}
            />
          ) : null}
        </ReportSection>

        {payload.periodMode !== "ytd" && payload.weeklyScorecards?.length ? (
          <ReportSection
            title="Weekly Scorecard"
          >
            <WeeklyScorecard rows={payload.weeklyScorecards} />
          </ReportSection>
        ) : null}

        {payload.inventorySnapshot ? (
          <ReportSection
            title="Inventory Snapshot"
          >
            <InventoryCard snapshot={payload.inventorySnapshot} />
          </ReportSection>
        ) : null}

        {performanceProductGalleryRows.length || inventoryProductGalleryRows.length ? (
          <ReportSection
            title="Product Performance and Inventory"
          >
            <SharedProductGallery
              inventoryRows={inventoryProductGalleryRows}
              performanceRows={performanceProductGalleryRows}
              periodMode={payload.periodMode}
            />
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
  aside,
  asideTone,
  children,
}: {
  title: string;
  aside?: string;
  asideTone?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="sectionBlock">
      <div className="sectionTitle">
        <div>
          <h2>{title}</h2>
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

function SalesDriverGrid({
  current,
  prior,
  drivers,
  periodTitle,
  priorPeriodTitle,
}: {
  current: SnapshotMetricSet;
  prior: SnapshotMetricSet;
  drivers: SnapshotMonthlyDrivers;
  periodTitle: string;
  priorPeriodTitle: string;
}) {
  const avgSalePerTransaction = drivers.avgSalePerTransaction ?? (current.transactions ? current.sales / current.transactions : 0);
  const priorAvgSalePerTransaction = drivers.priorAvgSalePerTransaction ?? (prior.transactions ? prior.sales / prior.transactions : 0);
  const avgUnitsPerTransaction = drivers.avgUnitsPerTransaction ?? (current.transactions ? current.units / current.transactions : 0);
  const priorAvgUnitsPerTransaction = drivers.priorAvgUnitsPerTransaction ?? (prior.transactions ? prior.units / prior.transactions : 0);
  const avgSalePerUnit = drivers.avgSalePerUnit ?? (current.units ? current.sales / current.units : 0);
  const priorAvgSalePerUnit = drivers.priorAvgSalePerUnit ?? (prior.units ? prior.sales / prior.units : 0);
  const salesDelta = current.sales - prior.sales;
  const unitDelta = current.units - prior.units;
  const transactionDelta = current.transactions - prior.transactions;
  const avgTransactionDelta = avgSalePerTransaction - priorAvgSalePerTransaction;
  const avgUnitDelta = avgSalePerUnit - priorAvgSalePerUnit;
  const hasTransactionData = hasComparableTransactionData(current, prior);
  const transactionBasis = comparableTransactionBasis(current, prior);
  const transactionLabel = transactionMetricLabel(transactionBasis);
  const transactionUnitLabel = "transaction";
  const maxSales = Math.max(current.sales, prior.sales, 1);
  const currentSalesWidth = Math.max(3, (current.sales / maxSales) * 100);
  const priorSalesWidth = Math.max(3, (prior.sales / maxSales) * 100);
  const takeaways = [
    `Sales: ${changeText(current.sales, prior.sales)} (${signedCurrencyText(salesDelta)}) vs LY.`,
    `Units: ${changeText(current.units, prior.units)}.`,
    hasTransactionData
      ? `${transactionLabel}: ${changeText(current.transactions, prior.transactions)}.`
      : null,
    hasTransactionData
      ? `${transactionAverageLabel(transactionBasis)}: ${currencyText(avgSalePerTransaction)} vs ${currencyText(priorAvgSalePerTransaction)} LY.`
      : `Avg $/unit: ${currencyText(avgSalePerUnit)} vs ${currencyText(priorAvgSalePerUnit)} LY.`,
    `Top 5 styles: ${drivers.topFiveStyleShare.toFixed(1)}% of sales (${currencyText(drivers.topFiveStyleSales)}).`,
  ].filter(Boolean);

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
          label={transactionLabel}
          value={hasTransactionData ? `${numberText(current.transactions)} vs ${numberText(prior.transactions)} LY` : "NA"}
          details={[hasTransactionData ? `Change: ${deltaText(transactionDelta, current.transactions, prior.transactions)}` : "No transaction data"]}
          tone={hasTransactionData ? transactionDelta : 0}
        />
        <DriverTile
          label="Units"
          value={`${numberText(current.units)} vs ${numberText(prior.units)} LY`}
          details={[
            `Change: ${deltaText(unitDelta, current.units, prior.units)}`,
            `Avg $ / unit: ${currencyText(avgSalePerUnit)} vs ${currencyText(priorAvgSalePerUnit)} LY`,
          ]}
          tone={unitDelta}
        />
        {hasTransactionData ? (
          <DriverTile
            label={transactionAverageLabel(transactionBasis)}
            value={currencyText(avgSalePerTransaction)}
            details={[
              `${decimalText(avgUnitsPerTransaction)} units / ${transactionUnitLabel}`,
              `LY: ${currencyText(priorAvgSalePerTransaction)} | ${decimalText(priorAvgUnitsPerTransaction)} units / ${transactionUnitLabel}`,
            ]}
            tone={avgTransactionDelta}
          />
        ) : (
          <DriverTile
            label="Avg $ / Unit"
            value={currencyText(avgSalePerUnit)}
            details={[`LY: ${currencyText(priorAvgSalePerUnit)}`]}
            tone={avgUnitDelta}
          />
        )}
        <DriverTile
          label="Core Style Dependence"
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

function WeeklyScorecard({ rows }: { rows: SnapshotWeeklyScorecardRow[] }) {
  return (
    <div className="weeklyScorecardList">
      {rows.map((row) => {
        const salesDelta = row.current.sales - row.prior.sales;
        const unitsDelta = row.current.units - row.prior.units;
        const transactionDelta = row.current.transactions - row.prior.transactions;
        const hasSalesActivity =
          row.current.sales !== 0 || row.current.units !== 0 || row.prior.sales !== 0 || row.prior.units !== 0;
        const hasTransactionData = hasComparableTransactionData(row.current, row.prior);
        const transactionLabel = transactionMetricLabel(comparableTransactionBasis(row.current, row.prior));
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
                <em>{transactionLabel}</em>
                <strong>{hasTransactionData ? numberText(row.current.transactions) : "NA"}</strong>
                <small className={hasTransactionData ? changeClass(transactionDelta) : ""}>
                  {hasTransactionData ? `${signedNumberText(transactionDelta)} vs LY` : hasSalesActivity ? "No transaction data" : "0 vs LY"}
                </small>
              </span>
            </div>

            <div className="weeklyTopProducts">
              <span>Top 3 Products</span>
              {topProducts.length ? (
                <div className="weeklyTopProductList">
                  {topProducts.map((item) => (
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

function TopSalesItemsCard({ bestDay, periodTitle }: { bestDay: SnapshotBestDay; periodTitle: string }) {
  const hasDailySales = (bestDay.dayCount ?? 0) > 1;
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
            <div className="topSalesProduct" key={`${item.rank}-${item.style}-${item.artCode}`}>
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
            ? "Coverage is not available yet because inventory cannot be matched cleanly to this sales pace."
            : `At the current sales pace only, this equals about ${snapshot.coverage.toFixed(1)} months of supply.`}
          {" "}
          Use the position read to account for the faster campus and football demand window ahead.
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
          <span>{position.label === "Heavy" ? "Heavy" : "Built"}</span>
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

function hasComparableTransactionData(current: SnapshotMetricSet, prior: SnapshotMetricSet) {
  const basis = comparableTransactionBasis(current, prior);
  const currentKnown = basis !== "none" && (current.transactionsKnown ?? current.transactions > 0);
  const priorKnown = basis !== "none" && (prior.transactionsKnown ?? prior.transactions > 0);
  const priorHasActivity = prior.sales !== 0 || prior.units !== 0 || prior.transactions !== 0;
  return currentKnown && (priorKnown || !priorHasActivity);
}

function comparableTransactionBasis(current: SnapshotMetricSet, prior: SnapshotMetricSet) {
  if (current.transactionBasis === "receipt" || prior.transactionBasis === "receipt") return "receipt";
  if (current.transactionBasis === "product-line" || prior.transactionBasis === "product-line") return "product-line";
  if ((current.transactionsKnown ?? current.transactions > 0) || (prior.transactionsKnown ?? prior.transactions > 0)) return "receipt";
  return "none";
}

function transactionMetricLabel(basis: ReturnType<typeof comparableTransactionBasis>) {
  void basis;
  return "Transactions";
}

function transactionAverageLabel(basis: ReturnType<typeof comparableTransactionBasis>) {
  void basis;
  return "Avg Transaction";
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

function shareHeroPeriodLabel(payload: ReportSnapshotPayload) {
  if (payload.selectedMonth) return `Showing ${monthText(payload.selectedMonth)}`;
  return `Showing ${payload.periodTitle}`;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function sharedPerformanceProductGalleryRows(payload: ReportSnapshotPayload): SharedProductGalleryItem[] {
  const inventoryRows = new Map(sharedInventoryProductGalleryRows(payload).map((row) => [row.key, row]));

  return payload.topArt.map((row, index) => {
    const inventoryRow = inventoryRows.get(row.key);
    return {
      rank: row.rank,
      key: row.key,
      style: row.style,
      color: row.color,
      artCode: row.artCode,
      periodUnits: row.units,
      periodSales: row.sales,
      ytdUnits: row.cyUnits,
      ytdSales: row.cySales,
      priorYearUnits: row.priorYearUnits,
      priorYtdUnits: inventoryRow?.priorYtdUnits,
      inventoryUnits: row.inventoryUnits ?? inventoryRow?.inventoryUnits,
      audience: inventoryRow?.audience,
      productCategory: inventoryRow?.productCategory,
      imageUrl: row.imageUrl ?? inventoryRow?.imageUrl ?? null,
      productUrl: row.productUrl ?? inventoryRow?.productUrl,
    };
  }).map((row, index) => ({ ...row, rank: index + 1 }));
}

function sharedInventoryProductGalleryRows(payload: ReportSnapshotPayload): SharedProductGalleryItem[] {
  return (payload.inventoryTracker ?? []).map((row, index) => ({
    rank: row.rank || index + 1,
    key: row.key,
    style: row.style,
    color: row.color,
    artCode: row.artCode,
    periodUnits: 0,
    periodSales: 0,
    ytdUnits: row.ytdUnits ?? 0,
    ytdSales: row.ytdSales ?? 0,
    priorYearUnits: row.priorYearUnits,
    priorYtdUnits: row.priorYtdUnits,
    inventoryUnits: row.inventoryUnits,
    audience: row.audience,
    productCategory: row.productCategory,
    imageUrl: row.imageUrl,
    productUrl: row.productUrl,
  })).map((row, index) => ({ ...row, rank: index + 1 }));
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
      ? "Balanced inventory against current pace and seasonal demand."
      : label === "Lean"
        ? "Lean inventory for the demand window ahead."
        : "Heavy inventory against the current selling pace.",
    detail: coverage == null
      ? "Current stock cannot be matched cleanly to recent selling pace yet."
      : `Current stock covers about ${coverage.toFixed(1)} months at the normalized sales pace.`,
    comparison: "Prior-year same-month inventory context was not saved with this older snapshot.",
  };
}
