import { createClient } from "@supabase/supabase-js";
import { currencyText, dateText, monthText, numberText } from "@/lib/formatters";
import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  isReportSnapshotPayload,
  type ReportSnapshotPayload,
  type ReportSnapshotRecord,
  type SnapshotMetricSet,
} from "@/lib/reportSnapshot";
import { PrintButton } from "./PrintButton";
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
  const reportFileName = `${payload.accountName}-${payload.periodTitle}-SalesLens`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

  return (
    <main className="publicShell">
      <section className="publicReport" id="saleslens-report-capture">
        <header className="publicHeader">
          <div>
            <div className="publicBrand">
              <strong>SalesLens</strong>
              <span>by Lester Sales</span>
            </div>
            <h1>{payload.accountName}</h1>
            <p>{payload.periodTitle} sales snapshot</p>
          </div>
          <div>
            <strong>{payload.brandFilter}</strong>
            <span>Generated {dateText(payload.generatedAt.slice(0, 10))}</span>
            <PrintButton fileName={reportFileName} />
          </div>
        </header>

        <section className="overviewStrip publicOverview">
          <article>
            <span>Period</span>
            <strong>{payload.periodTitle}</strong>
          </article>
          <article>
            <span>Current Sales</span>
            <strong>{currencyText(payload.currentMetrics.sales)}</strong>
          </article>
          <article>
            <span>Prior Sales</span>
            <strong>{currencyText(payload.priorMetrics.sales)}</strong>
          </article>
          <article>
            <span>Change</span>
            <strong className={changeClass(payload.currentMetrics.sales - payload.priorMetrics.sales)}>
              {changeText(payload.currentMetrics.sales, payload.priorMetrics.sales)}
            </strong>
          </article>
        </section>

        <ReportSection title="YTD Sales Tracker" subtitle={`${payload.periodTitle} compared with the same date range last year.`}>
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

        <ReportSection title="Sales Summary" subtitle={`${payload.periodTitle} vs ${payload.priorPeriodTitle}`}>
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
                <h4>Best Sales Day</h4>
                <strong>{dateText(payload.bestDay.date)}</strong>
              </div>
              <p className="compactLine">
                {currencyText(payload.bestDay.sales)} | {numberText(payload.bestDay.units)} units |{" "}
                {numberText(payload.bestDay.transactions)} transactions
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

        <ReportSection title="Style Study" subtitle="Style-level units, sales, colors, and artwork breadth.">
          <StyleStudyTabs
            monthlyStyles={payload.styleStudyMonthly ?? payload.topStyles}
            ytdStyles={payload.styleStudyYtd ?? payload.topStyles}
            previousMonthTitle={payload.previousMonthTitle ?? "last month"}
            currentLabel={payload.periodMode === "monthly" ? "Current Month" : "Selected Year"}
            currentCompareLabel={payload.periodMode === "monthly" ? "Compare" : "LY"}
          />
        </ReportSection>

        <ReportSection
          title="Top 25 by Art"
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
                  <span>{payload.periodMode === "monthly" ? "Month" : "Year"}: {numberText(row.units)} Units | {currencyText(row.sales)}</span>
                  {payload.periodMode === "monthly" ? (
                    <span>YTD: {numberText(row.cyUnits)} Units | {currencyText(row.cySales)}</span>
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

function ReportSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="sectionBlock">
      <div className="sectionTitle">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
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

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
