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
