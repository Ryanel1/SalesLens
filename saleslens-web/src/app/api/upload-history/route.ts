import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";

type AuthenticatedClient =
  | { response: NextResponse }
  | { supabase: SupabaseClient };

const UPLOAD_SELECT = [
  "id",
  "customer_id",
  "source_file",
  "original_file_name",
  "received_date",
  "sales_period_start",
  "sales_period_end",
  "row_count",
  "skipped_count",
  "total_sales",
  "total_units",
  "status",
  "created_at",
].join(",");

export async function GET(request: NextRequest) {
  const auth = await authenticatedClient(request);
  if ("response" in auth) return auth.response;

  const customerId = clean(request.nextUrl.searchParams.get("customerId"));
  if (!customerId) {
    return NextResponse.json({ error: "A customer is required." }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("uploads")
    .select(UPLOAD_SELECT)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ uploads: data ?? [] });
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticatedClient(request);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null) as { uploadId?: unknown; customerId?: unknown } | null;
  const uploadId = clean(body?.uploadId);
  const customerId = clean(body?.customerId);
  if (!uploadId || !customerId) {
    return NextResponse.json({ error: "An upload and customer are required." }, { status: 400 });
  }

  const { data: salesRows, error: salesError } = await auth.supabase
    .from("sales_records")
    .delete()
    .eq("upload_id", uploadId)
    .eq("customer_id", customerId)
    .select("id");

  if (salesError) {
    return NextResponse.json({ error: salesError.message }, { status: 500 });
  }

  const { data: inventoryRows, error: inventoryError } = await auth.supabase
    .from("inventory_records")
    .delete()
    .eq("upload_id", uploadId)
    .eq("customer_id", customerId)
    .select("id");

  if (inventoryError) {
    return NextResponse.json({ error: inventoryError.message }, { status: 500 });
  }

  const { data: uploadRows, error: uploadError } = await auth.supabase
    .from("uploads")
    .delete()
    .eq("id", uploadId)
    .eq("customer_id", customerId)
    .select("id");

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  if (!uploadRows?.length) {
    return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  }

  return NextResponse.json({
    deletedSalesRecords: salesRows?.length ?? 0,
    deletedInventoryRecords: inventoryRows?.length ?? 0,
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticatedClient(request);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null) as {
    customerId?: unknown;
    salesPeriodEnd?: unknown;
    salesPeriodStart?: unknown;
    uploadId?: unknown;
  } | null;
  const uploadId = clean(body?.uploadId);
  const customerId = clean(body?.customerId);
  const salesPeriodStart = cleanDate(body?.salesPeriodStart);
  const salesPeriodEnd = cleanDate(body?.salesPeriodEnd);

  if (!uploadId || !customerId || !salesPeriodStart || !salesPeriodEnd) {
    return NextResponse.json({ error: "An upload, customer, start date, and end date are required." }, { status: 400 });
  }
  if (salesPeriodStart > salesPeriodEnd) {
    return NextResponse.json({ error: "The start date must be before the end date." }, { status: 400 });
  }

  const { data: existingRows, error: existingError } = await auth.supabase
    .from("uploads")
    .select("id")
    .eq("id", uploadId)
    .eq("customer_id", customerId)
    .limit(1);

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existingRows?.length) {
    return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  }

  const [salesDateUpdate, inventoryDateUpdate] = await Promise.all([
    updateSingleDateUpload(auth.supabase, "sales_records", "transaction_date", uploadId, customerId, salesPeriodStart),
    updateSingleDateUpload(auth.supabase, "inventory_records", "inventory_date", uploadId, customerId, salesPeriodStart),
  ]);

  if (salesDateUpdate.error) {
    return NextResponse.json({ error: salesDateUpdate.error }, { status: 500 });
  }
  if (inventoryDateUpdate.error) {
    return NextResponse.json({ error: inventoryDateUpdate.error }, { status: 500 });
  }

  const { data: upload, error: uploadError } = await auth.supabase
    .from("uploads")
    .update({
      sales_period_start: salesPeriodStart,
      sales_period_end: salesPeriodEnd,
    })
    .eq("id", uploadId)
    .eq("customer_id", customerId)
    .select(UPLOAD_SELECT)
    .single();

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  return NextResponse.json({
    upload,
    updatedInventoryRecordDates: inventoryDateUpdate.updatedCount,
    updatedSalesRecordDates: salesDateUpdate.updatedCount,
  });
}

async function authenticatedClient(request: NextRequest): Promise<AuthenticatedClient> {
  const config = getSupabaseConfig();
  if (!config) {
    return { response: NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 }) };
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }

  const authClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }

  return {
    supabase: createClient(config.supabaseUrl, config.supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }),
  };
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanDate(value: unknown) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

async function updateSingleDateUpload(
  supabase: SupabaseClient,
  table: "inventory_records" | "sales_records",
  dateColumn: "inventory_date" | "transaction_date",
  uploadId: string,
  customerId: string,
  nextDate: string,
) {
  const { data: firstRows, error: firstError } = await supabase
    .from(table)
    .select(dateColumn)
    .eq("upload_id", uploadId)
    .eq("customer_id", customerId)
    .limit(1);

  if (firstError) return { error: firstError.message, updatedCount: 0 };
  const firstDate = (firstRows?.[0] as Record<string, unknown> | undefined)?.[dateColumn] as string | null | undefined;
  if (!firstDate) return { error: "", updatedCount: 0 };

  const { count: differentDateCount, error: countError } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("upload_id", uploadId)
    .eq("customer_id", customerId)
    .neq(dateColumn, firstDate);

  if (countError) return { error: countError.message, updatedCount: 0 };
  if (differentDateCount) return { error: "", updatedCount: 0 };

  const { data: updatedRows, error: updateError } = await supabase
    .from(table)
    .update({ [dateColumn]: nextDate })
    .eq("upload_id", uploadId)
    .eq("customer_id", customerId)
    .select("id");

  if (updateError) return { error: updateError.message, updatedCount: 0 };
  return { error: "", updatedCount: updatedRows?.length ?? 0 };
}
