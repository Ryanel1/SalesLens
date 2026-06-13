"use client";

import { useState } from "react";

export function PrintButton({ fileName }: { fileName: string }) {
  const [isSaving, setIsSaving] = useState(false);

  async function saveReport() {
    const report = document.getElementById("saleslens-report-capture");
    if (!report || isSaving) return;

    setIsSaving(true);
    try {
      await document.fonts.ready;
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const canvas = await html2canvas(report, {
        backgroundColor: "#f6f2ea",
        logging: false,
        scale: Math.min(2, window.devicePixelRatio || 1.5),
        useCORS: true,
        windowWidth: report.scrollWidth,
        windowHeight: report.scrollHeight,
      });

      const imageData = canvas.toDataURL("image/jpeg", 0.92);
      const pdfWidth = 1440;
      const pdfHeight = (canvas.height / canvas.width) * pdfWidth;
      const pdf = new jsPDF({
        format: [pdfWidth, pdfHeight],
        orientation: pdfWidth >= pdfHeight ? "landscape" : "portrait",
        unit: "pt",
      });

      pdf.addImage(imageData, "JPEG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${fileName || "SalesLens-report"}.pdf`);
    } catch (error) {
      window.alert(error instanceof Error ? `Could not save PDF: ${error.message}` : "Could not save PDF.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <button className="printButton" data-html2canvas-ignore="true" onClick={saveReport} disabled={isSaving}>
      {isSaving ? "Saving..." : "Save as PDF"}
    </button>
  );
}
