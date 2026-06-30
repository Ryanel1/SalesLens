"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { currencyText, numberText, wholeCurrencyText } from "@/lib/formatters";

type ProductGalleryView = "top-sellers" | "inventory";
type ProductGallerySortDirection = "descending" | "ascending";
type InventoryAudienceFilter = "All" | "Mens" | "Womens" | "Youth";
type InventoryProductFilter = "Fleece" | "Reverse Weave" | "Tees" | "Namedrop";
type InventoryProductCategory = "Fleece" | "Reverse Weave" | "Tees" | "Other";
type InventoryAudience = "Unisex" | "Womens" | "Mens" | "Youth";

export type SharedProductGalleryItem = {
  rank: number;
  key: string;
  style: string;
  color: string;
  artCode: string;
  periodUnits: number;
  periodSales: number;
  ytdUnits: number;
  ytdSales: number;
  priorYearUnits?: number | null;
  priorYtdUnits?: number | null;
  inventoryUnits?: number | null;
  audience?: InventoryAudience;
  productCategory?: InventoryProductCategory;
  imageUrl: string | null;
  productUrl?: string | null;
};

const INVENTORY_AUDIENCE_FILTERS: Exclude<InventoryAudienceFilter, "All">[] = ["Mens", "Womens", "Youth"];
const INVENTORY_PRODUCT_FILTERS: InventoryProductFilter[] = ["Fleece", "Tees", "Reverse Weave", "Namedrop"];
const REBEL_RAGS_NAMEDROP_CT1000_ARTS = new Set([
  "00367241",
  "03491635",
  "03503264",
  "03503316",
  "03503317",
  "03503347",
  "03503350",
  "03503351",
  "03503432",
  "03661320",
  "03687238",
  "03687242",
  "03687253",
  "03687254",
  "03687256",
  "03687272",
  "03687276",
  "03687288",
  "03751691",
  "03751742",
  "03751856",
  "03751860",
  "03751861",
  "03751866",
  "03751911",
  "03751913",
  "03751915",
  "03751916",
  "03751966",
  "03752042",
  "03804603",
  "03804604",
  "03804605",
  "03854968",
  "03884278",
]);

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

export function SharedProductGallery({
  inventoryRows,
  performanceRows,
  periodMode,
}: {
  inventoryRows: SharedProductGalleryItem[];
  performanceRows: SharedProductGalleryItem[];
  periodMode?: "monthly" | "ytd";
}) {
  const [productGalleryView, setProductGalleryView] = useState<ProductGalleryView>(() => (performanceRows.length ? "top-sellers" : "inventory"));
  const [productGallerySortDirection, setProductGallerySortDirection] = useState<ProductGallerySortDirection>("descending");
  const [inventoryAudienceFilter, setInventoryAudienceFilter] = useState<InventoryAudienceFilter>("All");
  const [inventoryProductFilters, setInventoryProductFilters] = useState<InventoryProductFilter[]>([]);
  const [inventoryMenuOpen, setInventoryMenuOpen] = useState<"view" | "refine" | null>(null);
  const inventoryControlsRef = useRef<HTMLDivElement | null>(null);

  const productGalleryUsesInventory = productGalleryView === "inventory";
  const filteredInventoryRows = useMemo(() => {
    return inventoryRows.filter((row) => (
      inventoryAudienceMatches(row, inventoryAudienceFilter) &&
      inventoryProductMatches(row, inventoryProductFilters)
    ));
  }, [inventoryAudienceFilter, inventoryProductFilters, inventoryRows]);
  const sourceRows = productGalleryUsesInventory ? filteredInventoryRows : performanceRows;
  const productGalleryRows = useMemo(() => {
    const rows = productGallerySortDirection === "ascending" ? [...sourceRows].reverse() : [...sourceRows];
    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
  }, [productGallerySortDirection, sourceRows]);
  const productGalleryTotalItems = sourceRows.length;
  const productGalleryVisibleUnits = sum(productGalleryRows.map((row) => (productGalleryUsesInventory ? row.inventoryUnits ?? 0 : row.periodUnits)));
  const productGalleryVisibleSales = sum(productGalleryRows.map((row) => (productGalleryUsesInventory ? row.ytdSales : row.periodSales)));
  const productGallerySortMetricLabel = productGalleryUsesInventory ? "Inventory" : "Units";
  const productGallerySortDirectionLabel = productGallerySortDirection === "descending" ? "Descending" : "Ascending";
  const productGallerySortLabel = `${productGallerySortMetricLabel} ${productGallerySortDirectionLabel}`;
  const productGallerySortArrow = productGallerySortDirection === "descending" ? "↓" : "↑";
  const productGalleryRefineLabel = inventoryFilterSummary(inventoryAudienceFilter, inventoryProductFilters);
  const productGalleryActiveRefinements = [
    inventoryAudienceFilter === "All" ? null : inventoryAudienceFilterLabel(inventoryAudienceFilter),
    ...inventoryProductFilters,
  ].filter(Boolean) as string[];
  const productGalleryDecisionSummary = productGalleryTotalItems
    ? `${productGalleryViewLabel(productGalleryView)}: ${numberText(productGalleryTotalItems)} items | ${productGallerySortLabel} | ${numberText(productGalleryVisibleUnits)} units | ${currencyText(productGalleryVisibleSales)}`
    : "No product gallery items match the selected filters.";

  useEffect(() => {
    if (!inventoryMenuOpen) return undefined;

    function handlePointerDown(event: PointerEvent) {
      if (inventoryControlsRef.current?.contains(event.target as Node)) return;
      setInventoryMenuOpen(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setInventoryMenuOpen(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [inventoryMenuOpen]);

  function clearInventoryFilters() {
    setInventoryAudienceFilter("All");
    setInventoryProductFilters([]);
    setInventoryMenuOpen(null);
  }

  function applyInventoryAudienceFilter(filter: InventoryAudienceFilter) {
    setInventoryAudienceFilter(filter);
    if (inventoryProductFilters.includes("Namedrop") && filter !== "All" && filter !== "Mens") {
      setInventoryProductFilters([]);
    }
  }

  function toggleInventoryProductFilter(filter: InventoryProductFilter) {
    if (filter === "Namedrop") {
      setInventoryAudienceFilter("All");
      setInventoryProductFilters((current) => (current.includes("Namedrop") ? [] : ["Namedrop"]));
      setInventoryMenuOpen(null);
      return;
    }

    setInventoryProductFilters((current) => (
      current.filter((item) => item !== "Namedrop").includes(filter)
        ? current.filter((item) => item !== filter && item !== "Namedrop")
        : [...current.filter((item) => item !== "Namedrop"), filter]
    ));
  }

  function toggleProductGallerySortDirection() {
    setProductGallerySortDirection((current) => (current === "descending" ? "ascending" : "descending"));
    setInventoryMenuOpen(null);
  }

  return (
    <>
      <p className="sharedProductGallerySummary">{productGalleryDecisionSummary}</p>
      <div className="inventoryControls" ref={inventoryControlsRef}>
        <div className="inventoryDropdownControls">
          <div className={`inventoryDropdown ${inventoryMenuOpen === "view" ? "isOpen" : ""}`}>
            <button
              aria-expanded={inventoryMenuOpen === "view"}
              className="inventoryDropdownTrigger"
              type="button"
              onClick={() => setInventoryMenuOpen((current) => (current === "view" ? null : "view"))}
            >
              <span>View</span>
              <strong>{productGalleryViewLabel(productGalleryView)}</strong>
            </button>
            {inventoryMenuOpen === "view" ? (
              <div className="inventoryDropdownMenu">
                {(["top-sellers", "inventory"] as ProductGalleryView[]).map((view) => (
                  <button
                    aria-pressed={productGalleryView === view}
                    className={`inventoryOption ${productGalleryView === view ? "active" : ""}`}
                    key={view}
                    type="button"
                    onClick={() => {
                      setProductGalleryView(view);
                      setInventoryMenuOpen(null);
                    }}
                  >
                    <span className="inventoryOptionMark" aria-hidden="true" />
                    <span>{productGalleryViewLabel(view)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="inventoryDropdown sortDirectionControl">
            <button
              aria-label={`Sort ${productGallerySortMetricLabel.toLowerCase()} ${productGallerySortDirection === "descending" ? "largest first" : "smallest first"}`}
              className="inventoryDropdownTrigger sortDirectionToggle"
              type="button"
              onClick={toggleProductGallerySortDirection}
            >
              <span>Sort</span>
              <strong>{productGallerySortMetricLabel}</strong>
              <b aria-hidden="true">{productGallerySortArrow}</b>
            </button>
          </div>
          <div className={`inventoryDropdown ${inventoryMenuOpen === "refine" ? "isOpen" : ""}`}>
            <button
              aria-expanded={inventoryMenuOpen === "refine"}
              className="inventoryDropdownTrigger"
              type="button"
              onClick={() => setInventoryMenuOpen((current) => (current === "refine" ? null : "refine"))}
            >
              <span>Refine</span>
              <strong>{productGalleryRefineLabel}</strong>
            </button>
            {inventoryMenuOpen === "refine" ? (
              <div className="inventoryDropdownMenu wide refineMenu">
                {productGalleryActiveRefinements.length ? (
                  <button
                    className="inventoryResetOption"
                    type="button"
                    onClick={clearInventoryFilters}
                  >
                    Clear filters
                  </button>
                ) : null}
                <div className="inventoryOptionGroup">
                  <p>Audience</p>
                  {(["All", ...INVENTORY_AUDIENCE_FILTERS] as InventoryAudienceFilter[]).map((filter) => (
                    <button
                      aria-pressed={inventoryAudienceFilter === filter}
                      className={`inventoryOption ${inventoryAudienceFilter === filter ? "active" : ""}`}
                      key={filter}
                      type="button"
                      onClick={() => applyInventoryAudienceFilter(filter)}
                    >
                      <span className="inventoryOptionMark" aria-hidden="true" />
                      <span>{inventoryAudienceFilterLabel(filter)}</span>
                    </button>
                  ))}
                </div>
                <div className="inventoryOptionGroup">
                  <p>Product Type</p>
                  {INVENTORY_PRODUCT_FILTERS.map((filter) => (
                    <button
                      aria-pressed={inventoryProductFilters.includes(filter)}
                      className={`inventoryOption ${inventoryProductFilters.includes(filter) ? "active" : ""}`}
                      key={filter}
                      type="button"
                      onClick={() => toggleInventoryProductFilter(filter)}
                    >
                      <span className="inventoryOptionMark square" aria-hidden="true" />
                      <span>{filter}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {productGalleryActiveRefinements.length ? (
          <div className="inventoryActiveFilters" aria-label="Active product gallery filters">
            {productGalleryActiveRefinements.map((label) => (
              <span key={label}>{label}</span>
            ))}
            <button type="button" onClick={clearInventoryFilters}>
              Clear
            </button>
          </div>
        ) : null}
      </div>
      {productGalleryRows.length ? (
        <div className="artGrid">
          {productGalleryRows.map((row) => (
            <article className="artCard" key={row.key}>
              <div className="artImage">
                <b>#{row.rank}</b>
                {row.imageUrl ? (
                  <ProductMedia
                    alt={`${row.style} ${row.artCode}`}
                    sizes="(max-width: 760px) 50vw, (max-width: 1180px) 25vw, 220px"
                    src={row.imageUrl}
                  />
                ) : <span>No Image</span>}
              </div>
              <div className="artMeta">
                <div className="artIdentity">
                  {row.productUrl ? (
                    <a className="artCodeLink" href={row.productUrl} target="_blank" rel="noreferrer">
                      {row.artCode}
                    </a>
                  ) : (
                    <strong>{row.artCode}</strong>
                  )}
                  <span>{row.style} | {row.color}</span>
                </div>
                <div className="artStats">
                  {row.inventoryUnits != null ? <span><em>On-Hand</em><strong>{numberText(row.inventoryUnits)} Units</strong></span> : null}
                  {row.inventoryUnits != null ? <i aria-hidden="true" className="artStatsDivider" /> : null}
                  {!productGalleryUsesInventory || row.periodUnits > 0 || row.periodSales > 0 ? (
                    <span><em>{periodMode === "monthly" ? "Month" : "Year"}</em><strong>{productCardSalesText(row.periodUnits, row.periodSales)}</strong></span>
                  ) : null}
                  <span><em>YTD</em><strong>{productCardSalesText(row.ytdUnits, row.ytdSales)}</strong></span>
                  <span><em>LY</em><strong>{inventoryPriorYearSoldText(row)}</strong></span>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="emptyNotice">
          <span>No product gallery items match the selected filters.</span>
          <button type="button" onClick={clearInventoryFilters}>
            Clear filters
          </button>
        </div>
      )}
    </>
  );
}

function productGalleryViewLabel(view: ProductGalleryView) {
  if (view === "top-sellers") return "Performance";
  return "Inventory";
}

function inventoryFilterSummary(audienceFilter: InventoryAudienceFilter, productFilters: InventoryProductFilter[]) {
  const filters = [
    audienceFilter === "All" ? null : inventoryAudienceFilterLabel(audienceFilter),
    ...productFilters,
  ].filter(Boolean);
  if (!filters.length) return "All";
  if (filters.length === 1) return filters[0];
  return `${filters.length} Filters`;
}

function inventoryAudienceFilterLabel(filter: InventoryAudienceFilter) {
  if (filter === "All") return "All";
  if (filter === "Mens") return "Men's";
  if (filter === "Womens") return "Women's";
  return "Youth";
}

function inventoryAudienceMatches(row: SharedProductGalleryItem, filter: InventoryAudienceFilter) {
  if (filter === "All") return true;
  return row.audience === filter;
}

function inventoryProductMatches(row: SharedProductGalleryItem, filters: InventoryProductFilter[]) {
  if (!filters.length) return true;
  return filters.some((filter) => {
    if (filter === "Namedrop") return inventoryNamedropMatches(row);

    return row.productCategory === filter;
  });
}

function inventoryNamedropMatches(row: SharedProductGalleryItem) {
  return row.style === "CT1000" && REBEL_RAGS_NAMEDROP_CT1000_ARTS.has(normalizedNamedropArtCode(row.artCode));
}

function normalizedNamedropArtCode(value: string) {
  const withoutPrefix = compactImagePart(value).replace(/^(APC|AEC|APO)/, "");
  return /^\d+$/.test(withoutPrefix) ? withoutPrefix.padStart(8, "0") : withoutPrefix;
}

function compactImagePart(value: string | null | undefined) {
  return value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
}

function inventoryPriorYearSoldText(row: { priorYearUnits?: number | null; priorYtdUnits?: number | null }) {
  const value = Object.prototype.hasOwnProperty.call(row, "priorYearUnits") ? row.priorYearUnits : row.priorYtdUnits;
  return value == null ? "NA" : `${numberText(value)} Units`;
}

function productCardSalesText(units: number, sales: number | null | undefined) {
  const unitText = `${numberText(units)} Units`;
  return sales ? `${unitText} (${wholeCurrencyText(sales)})` : unitText;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
