"use client";

import { useState } from "react";
import { StyleSignals } from "@/components/StyleSignals";
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
        {mode === "month" ? `${currentPeriodTitle} style movement vs ${previousMonthTitle}` : "YTD style movement vs last year"}
      </p>
      <StyleSignals styles={styles} compareLabel={compareLabel} />
    </>
  );
}
