import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchDashboardShell, type DashboardShellSummary, type SalesShellRecord } from "@/lib/reportData";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";

const GEAR_STYLE_PREFIXES = ["GDH", "G", "C400", "C603", "S650", "G209"];

type DashboardShellRequest = {
  customerId?: unknown;
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

  const body = await request.json().catch(() => null) as DashboardShellRequest | null;
  const customerId = clean(body?.customerId);
  if (!customerId) {
    return NextResponse.json({ error: "A customer is required." }, { status: 400 });
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { shell, error } = await fetchDashboardShell(supabase, customerId);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json({ shell: summarizeShell(shell.records) });
}

function summarizeShell(records: SalesShellRecord[]): DashboardShellSummary {
  const months = [...new Set(records.map((record) => monthKey(record.transaction_date)).filter((month): month is string => Boolean(month)))]
    .sort()
    .reverse();
  const years = [...new Set(months.map((month) => month.slice(0, 4)))]
    .sort()
    .reverse();
  const brandOptions = [...new Set(records.map(brandName))]
    .filter(Boolean)
    .sort();
  const latestMonthByYear: Record<string, string> = {};
  const latestMonthByBrandYear: Record<string, Record<string, string>> = {};
  const lastUploadedByBrand: Record<string, string> = {};
  let lastUploaded: string | null = null;

  records.forEach((record) => {
    const month = monthKey(record.transaction_date);
    const brand = brandName(record);
    if (record.transaction_date && (!lastUploaded || record.transaction_date > lastUploaded)) {
      lastUploaded = record.transaction_date;
    }
    if (record.transaction_date && (!lastUploadedByBrand[brand] || record.transaction_date > lastUploadedByBrand[brand])) {
      lastUploadedByBrand[brand] = record.transaction_date;
    }
    if (!month) return;

    const year = month.slice(0, 4);
    if (!latestMonthByYear[year] || month > latestMonthByYear[year]) {
      latestMonthByYear[year] = month;
    }

    latestMonthByBrandYear[brand] = latestMonthByBrandYear[brand] ?? {};
    if (!latestMonthByBrandYear[brand][year] || month > latestMonthByBrandYear[brand][year]) {
      latestMonthByBrandYear[brand][year] = month;
    }
  });

  return {
    months,
    years,
    brandOptions,
    lastUploaded,
    lastUploadedByBrand,
    latestMonthByYear,
    latestMonthByBrandYear,
  };
}

function brandName(record: SalesShellRecord) {
  const style = compactStyle(record.style_number) || compactStyle(record.raw_style_identifier);
  if (style.startsWith("CBR")) return "Champion";
  const classText = `${record.product_class ?? ""} ${record.master_style ?? ""}`.toUpperCase();
  if (classText.includes("GEAR") || classText.includes("COMFORT WASH")) return "Gear";
  if (isGearStyle(style)) return "Gear";
  return "Champion";
}

function isGearStyle(style: string) {
  const normalized = compactStyle(style);
  return GEAR_STYLE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function compactStyle(value: string | null | undefined) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function monthKey(value: string | null | undefined) {
  return value?.slice(0, 7) ?? null;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
