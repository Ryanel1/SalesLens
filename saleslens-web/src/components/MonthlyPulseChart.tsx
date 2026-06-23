export type MonthlyPulseMetric = {
  label: string;
  current: number;
  prior: number;
  currentText: string;
  priorText: string;
  deltaText: string;
  tone: number;
};

export function MonthlyPulseChart({ metrics }: { metrics: MonthlyPulseMetric[] }) {
  return (
    <div className="monthlyPulseChart" aria-label="Monthly scorecard comparison chart">
      <div className="monthlyPulseHeader">
        <span>Performance Pulse</span>
        <small>Current vs LY</small>
      </div>
      <div className="monthlyPulseRows">
        {metrics.map((metric) => {
          const maxValue = Math.max(Math.abs(metric.current), Math.abs(metric.prior), 1);
          const currentWidth = Math.max(3, (Math.abs(metric.current) / maxValue) * 100);
          const priorWidth = Math.max(3, (Math.abs(metric.prior) / maxValue) * 100);

          return (
            <div className="monthlyPulseRow" key={metric.label}>
              <div className="monthlyPulseLabel">
                <strong>{metric.label}</strong>
                <span className={metric.tone >= 0 ? "positive" : "negative"}>{metric.deltaText}</span>
              </div>
              <div className="monthlyPulseBars">
                <span className="monthlyPulseBar current" style={{ width: `${currentWidth}%` }} />
                <span className="monthlyPulseBar prior" style={{ width: `${priorWidth}%` }} />
              </div>
              <div className="monthlyPulseValues">
                <span>{metric.currentText}</span>
                <span>{metric.priorText} LY</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
