"use client";

export function PrintButton() {
  return (
    <button className="printButton" onClick={() => window.print()}>
      Save as PDF
    </button>
  );
}
