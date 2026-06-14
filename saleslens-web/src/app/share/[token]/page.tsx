import { createClient } from "@supabase/supabase-js";
import { currencyText, dateText, monthText, numberText, wholeCurrencyText } from "@/lib/formatters";
import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  isReportSnapshotPayload,
  type ReportSnapshotPayload,
  type ReportSnapshotRecord,
  type SnapshotInventory,
  type SnapshotMetricSet,
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
  const hasDailySales = (payload.bestDay.dayCount ?? 1) > 1;

  return (
    <main className={`publicShell ${accountThemeClass(payload.accountName)}`}>
      <section className="publicReport" id="saleslens-report-capture">
        <header className="dashboardHeader publicDashboardHeader">
          <div>
            <div className="navBrand publicShareBrand">
              <h1>SalesLens</h1>
              <p>by Lester Sales</p>
            </div>
            <h1>{payload.accountName}</h1>
            <p className="muted">Track current sales, prior-year movement, product breadth, and top sellers.</p>
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

        <ReportSection
          title={payload.periodMode === "ytd" ? "Year Sales Tracker" : "YTD Sales Tracker"}
          subtitle={`${payload.periodTitle} compared with the same date range last year.`}
          aside={changeText(payload.ytdLine.currentTotal, payload.ytdLine.priorTotal)}
          asideTone={payload.ytdLine.currentTotal - payload.ytdLine.priorTotal}
        >
          <div className="metricGrid three">
            <MetricCard label="Current YTD" value={currencyText(payload.ytdLine.currentTotal)} />
            <MetricCard label="Prior YTD" value={currencyText(payload.ytdLine.priorTotal)} />
            <MetricCard
              label="Total Change"
              value={currencyText(payload.ytdLine.currentTotal - payload.ytdLine.priorTotal)}
              tone={payload.ytdLine.currentTotal - payload.ytdLine.priorTotal}
            />
          </div>
          <StaticLineChart payload={payload} />
          {payload.ytdInsights ? (
            <div className="ytdInsightGrid">
              <YtdInsightCard
                label="Avg Monthly Sales"
                value={currencyText(payload.ytdInsights.averageMonthlySales)}
                detail={`${currencyText(payload.ytdInsights.priorAverageMonthlySales)} LY`}
                tone={payload.ytdInsights.averageMonthlySales - payload.ytdInsights.priorAverageMonthlySales}
              />
              <YtdInsightCard
                label="Styles Sold"
                value={numberText(payload.ytdInsights.stylesSold)}
                detail={`${numberText(payload.ytdInsights.priorStylesSold)} LY`}
                tone={payload.ytdInsights.stylesSold - payload.ytdInsights.priorStylesSold}
              />
              <YtdInsightCard
                label="Colors Sold"
                value={numberText(payload.ytdInsights.colorsSold)}
                detail={`${numberText(payload.ytdInsights.priorColorsSold)} LY`}
                tone={payload.ytdInsights.colorsSold - payload.ytdInsights.priorColorsSold}
              />
              <YtdInsightCard
                label="Artworks Sold"
                value={numberText(payload.ytdInsights.artworksSold)}
                detail={`${numberText(payload.ytdInsights.priorArtworksSold)} LY`}
                tone={payload.ytdInsights.artworksSold - payload.ytdInsights.priorArtworksSold}
              />
            </div>
          ) : null}
        </ReportSection>

        <ReportSection
          title={payload.periodMode === "ytd" ? "Selected Year Summary" : "Monthly Sales Tracker"}
          subtitle={`${payload.periodTitle} compared with ${payload.priorPeriodTitle}.`}
          aside={changeText(payload.currentMetrics.sales, payload.priorMetrics.sales)}
          asideTone={payload.currentMetrics.sales - payload.priorMetrics.sales}
        >
          <div className="metricGrid four">
            <MetricCard label="Sales" value={currencyText(payload.currentMetrics.sales)} />
            <MetricCard label="Transactions" value={numberText(payload.currentMetrics.transactions)} />
            <MetricCard label="Units" value={numberText(payload.currentMetrics.units)} />
            <MetricCard label="Last Year Sales" value={currencyText(payload.priorMetrics.sales)} />
          </div>

          <div className="insightGrid">
            <article className="insightCard">
              <h4>Sales Mix Units</h4>
              <div className="mixStack">
                {payload.salesMix.map((slice) => (
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
              </div>
            </article>

            <article className="insightCard">
              <div className="cardHeading">
                <h4>Sales Comparison</h4>
                <strong className={changeClass(payload.currentMetrics.sales - payload.priorMetrics.sales)}>
                  {changeText(payload.currentMetrics.sales, payload.priorMetrics.sales)}
                </strong>
              </div>
              <MetricCompare current={payload.currentMetrics} prior={payload.priorMetrics} />
            </article>

            <article className="insightCard">
              <div className="cardHeading">
                <h4>{hasDailySales ? "Best Sales Day" : "Top Sales Items"}</h4>
                <strong>{hasDailySales ? dateText(payload.bestDay.date) : payload.periodTitle}</strong>
              </div>
              <p className="compactLine">
                {currencyText(payload.bestDay.sales)} | {numberText(payload.bestDay.units)} units
                {hasDailySales ? ` | ${numberText(payload.bestDay.transactions)} transactions` : ""}
              </p>
              {payload.bestDay.items.map((item) => (
                <div className="bestRow" key={`${item.rank}-${item.style}-${item.artCode}`}>
                  <strong>#{item.rank} {item.style}</strong>
                  <span className="barTrack">
                    <span style={{ width: `${Math.max(3, item.units)}%` }} />
                  </span>
                  <small>{numberText(item.units)} | {currencyText(item.sales)}</small>
                </div>
              ))}
            </article>
          </div>
        </ReportSection>

        {payload.inventorySnapshot ? (
          <ReportSection
            title="Inventory Snapshot"
            subtitle={`Current on-hand inventory from the latest inventory data inside ${payload.periodTitle}.`}
            aside={dateText(payload.inventorySnapshot.date)}
          >
            <InventoryCard snapshot={payload.inventorySnapshot} />
          </ReportSection>
        ) : null}

        <ReportSection title="Top Performing Styles" subtitle="Style-level units, sales, colors, and artwork breadth.">
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
          title="Top Performing Arts"
          subtitle={`${payload.periodTitle} Top 25 Total: ${numberText(sum(payload.topArt.map((row) => row.units)))} Units | ${currencyText(sum(payload.topArt.map((row) => row.sales)))}`}
        >
          <div className="artGrid">
            {payload.topArt.map((row) => (
              <article className="artCard" key={row.key}>
                <div className="artImage">
                  <b>#{row.rank}</b>
                  {row.imageUrl ? <img src={row.imageUrl} alt={`${row.style} ${row.artCode}`} /> : <span>No Image</span>}
                </div>
                <div className="artMeta">
                  <strong>{row.artCode}</strong>
                  <span>{row.style} | {row.color}</span>
                  <span>{payload.periodMode === "monthly" ? "Month" : "Year"}: {numberText(row.units)} Units | {wholeCurrencyText(row.sales)}</span>
                  {payload.periodMode === "monthly" ? (
                    <span>YTD: {numberText(row.cyUnits)} Units | {wholeCurrencyText(row.cySales)}</span>
                  ) : null}
                  {row.inventoryUnits != null ? (
                    <span>Current Inv: {numberText(row.inventoryUnits)}</span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </ReportSection>

        <ReportSection title="All Styles Sold" subtitle={`${numberText(payload.allStyles.length)} styles for this report.`}>
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
                {payload.allStyles.map((style) => (
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
        </ReportSection>
      </section>
    </main>
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

  if (error || !row || !isReportSnapshotPayload(row.payload)) return null;

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
        {aside ? <strong className={asideTone == null ? "" : changeClass(asideTone)}>{aside}</strong> : null}
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

function InventoryCard({ snapshot }: { snapshot: SnapshotInventory }) {
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

function MetricCompare({ current, prior }: { current: SnapshotMetricSet; prior: SnapshotMetricSet }) {
  const maxSales = Math.max(current.sales, prior.sales, 1);
  return (
    <>
      <CompareBar label="Current" value={current.sales} max={maxSales} />
      <CompareBar label="Prior" value={prior.sales} max={maxSales} secondary />
    </>
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

function StaticLineChart({ payload }: { payload: ReportSnapshotPayload }) {
  const maxValue = Math.max(...payload.ytdLine.current, ...payload.ytdLine.prior, 1);
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
        <span><i className="dot current" />Current</span>
        <span><i className="dot prior" />Prior</span>
      </div>
      <svg viewBox="0 0 100 92" preserveAspectRatio="none" role="img" aria-label="YTD sales line chart">
        <line x1="6" x2="94" y1="86" y2="86" />
        <polyline points={points(payload.ytdLine.prior)} className="priorLine" />
        <polyline points={points(payload.ytdLine.current)} className="currentLine" />
      </svg>
    </div>
  );
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
