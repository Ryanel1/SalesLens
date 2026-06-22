import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildReportPayload,
  type InventoryAudienceFilter,
  type InventoryProductFilter,
  type InventorySort,
  type PeriodSelection,
  type TopArtSort,
} from "@/lib/reportBuilder";
import { fetchAllRecords, fetchInventoryRecords, fetchProductImages } from "@/lib/reportData";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";

type ReportPayloadRequest = {
  customerId?: unknown;
  brandFilter?: unknown;
  inventoryAudienceFilter?: unknown;
  inventoryPage?: unknown;
  inventoryPageSize?: unknown;
  inventoryProductFilters?: unknown;
  inventorySort?: unknown;
  period?: unknown;
  topArtSort?: unknown;
};

export async function POST(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const authClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as ReportPayloadRequest | null;
  const customerId = clean(body?.customerId);
  const period = periodSelection(body?.period);
  if (!customerId || !period) {
    return NextResponse.json({ error: "A customer and period are required." }, { status: 400 });
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id,name")
    .eq("id", customerId)
    .single();

  if (customerError || !customer) {
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  const [
    { records, error: recordsError },
    { records: inventoryRecords, error: inventoryError },
    { images },
  ] = await Promise.all([
    fetchAllRecords(supabase, customerId),
    fetchInventoryRecords(supabase, customerId),
    fetchProductImages(supabase, customerId),
  ]);

  if (recordsError) {
    return NextResponse.json({ error: recordsError }, { status: 500 });
  }

  if (inventoryError) {
    return NextResponse.json({ error: inventoryError }, { status: 500 });
  }

  const report = buildReportPayload({
    accountName: customer.name,
    brandFilter: clean(body?.brandFilter) || "All",
    generatedAt: new Date().toISOString(),
    images,
    inventoryAudienceFilter: inventoryAudienceFilterValue(body?.inventoryAudienceFilter),
    inventoryPage: positiveInteger(body?.inventoryPage, 1),
    inventoryPageSize: positiveInteger(body?.inventoryPageSize, 50),
    inventoryProductFilters: inventoryProductFilterValues(body?.inventoryProductFilters),
    inventoryRecords,
    inventorySort: inventorySortValue(body?.inventorySort),
    period,
    records,
    topArtSort: topArtSortValue(body?.topArtSort),
  });

  return NextResponse.json({ report });
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function inventorySortValue(value: unknown): InventorySort {
  return value === "lowest" ? "lowest" : "highest";
}

function inventoryAudienceFilterValue(value: unknown): InventoryAudienceFilter {
  return value === "Mens" || value === "Womens" || value === "Youth" ? value : "All";
}

function inventoryProductFilterValues(value: unknown): InventoryProductFilter[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is InventoryProductFilter => (
    item === "Fleece" ||
    item === "Reverse Weave" ||
    item === "Tees" ||
    item === "Namedrop"
  ));
}

function topArtSortValue(value: unknown): TopArtSort {
  return value === "dollars" ? "dollars" : "units";
}

function positiveInteger(value: unknown, fallback: number) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function periodSelection(value: unknown): PeriodSelection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { kind?: unknown; value?: unknown; year?: unknown };
  const periodValue = clean(candidate.value);
  const year = Number(candidate.year);
  if (!periodValue || !Number.isInteger(year)) return null;

  if (candidate.kind === "month" && /^\d{4}-\d{2}$/.test(periodValue)) {
    return { kind: "month", value: periodValue, year };
  }

  if (candidate.kind === "year" && /^\d{4}$/.test(periodValue)) {
    return { kind: "year", value: periodValue, year };
  }

  return null;
}
