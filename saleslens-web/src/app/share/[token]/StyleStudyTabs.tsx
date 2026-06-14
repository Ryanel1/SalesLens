"use client";

import { useState } from "react";
import { currencyText, numberText } from "@/lib/formatters";
import type { SnapshotTopStyle } from "@/lib/reportSnapshot";

export function StyleStudyTabs({
  monthlyStyles,
  ytdStyles,
  currentPeriodTitle,
  previousMonthTitle,
  currentLabel = "Current Month",
  currentCompareLabel = "LY",
}: {
  monthlyStyles: SnapshotTopStyle[];
  ytdStyles: SnapshotTopStyle[];
  currentPeriodTitle: string;
  previousMonthTitle: string;
  currentLabel?: string;
  currentCompareLabel?: string;
}) {
  const [mode, setMode] = useState<"month" | "ytd">("month");
  const styles = mode === "month" ? monthlyStyles : ytdStyles;
  const compareLabel = mode === "month" ? currentCompareLabel : "LY";

  return (
    <>
      <div className="studyTabs" aria-label="Style study views">
        <button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>
          {currentLabel}
        </button>
        <button className={mode === "ytd" ? "active" : ""} onClick={() => setMode("ytd")}>
          YTD
        </button>
      </div>
      <p className="studySubtitle">
        {mode === "month" ? `Top 10 Styles: ${currentPeriodTitle} vs ${previousMonthTitle}` : "Top 10 Styles vs Last YTD"}
      </p>
      <div className="styleComparisonGrid">
        {styles.map((style) => (
          <StyleCard key={style.style} style={style} compareLabel={compareLabel} />
        ))}
      </div>
    </>
  );
}

function StyleCard({ style, compareLabel }: { style: SnapshotTopStyle; compareLabel: string }) {
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
        CY: <span className={changeClass(style.colorCount - style.priorColorCount)}>{style.colorCount} Colors</span>,{" "}
        <span className={changeClass(style.artCount - style.priorArtCount)}>{style.artCount} Artworks</span> | {compareLabel}:{" "}
        <span className={changeClass(style.priorColorCount - style.colorCount)}>{style.priorColorCount} Colors</span>,{" "}
        <span className={changeClass(style.priorArtCount - style.artCount)}>{style.priorArtCount} Artworks</span>
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

function changeClass(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}
