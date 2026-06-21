import type { SupabaseClient } from "@supabase/supabase-js";

const REPORT_DATA_PAGE_SIZE = 1000;
const PRODUCT_IMAGE_BUCKET = "product-images";

export type SalesRecord = {
  id: string;
  customer_id: string;
  transaction_date: string;
  amount: number | string | null;
  units: number | null;
  transaction_number: string | null;
  barcode: string | null;
  parent_sku: string | null;
  sku: string | null;
  product_class: string | null;
  master_style: string | null;
  color: string | null;
  size: string | null;
  catalog_color_name: string | null;
  style_number: string | null;
  raw_style_identifier: string | null;
  color_code: string | null;
  art_code: string | null;
  inventory_units: number | null;
  year_to_date_amount: number | string | null;
  year_to_date_units: number | null;
};

export type InventoryRecord = {
  id: string;
  customer_id: string;
  upload_id: string | null;
  inventory_date: string;
  source_file: string;
  product_class: string | null;
  master_style: string | null;
  color: string | null;
  size: string | null;
  raw_style_identifier: string | null;
  style_number: string | null;
  catalog_color_name: string | null;
  art_code: string | null;
  inventory_units: number | null;
  current_retail: number | string | null;
};

export type MerchandiseRecord = {
  product_class: string | null;
  master_style: string | null;
  style_number: string | null;
  raw_style_identifier: string | null;
  catalog_color_name: string | null;
  color: string | null;
  color_code?: string | null;
  art_code: string | null;
};

export type ProductImage = {
  style_number: string;
  art_code: string;
  color: string;
  product_url: string | null;
  image_url: string | null;
  storage_path: string | null;
  resolved_url?: string | null;
};

export type DashboardData = {
  records: SalesRecord[];
  inventoryRecords: InventoryRecord[];
  images: ProductImage[];
};

export async function fetchAllRecords(client: SupabaseClient, customerId: string) {
  const records: SalesRecord[] = [];
  for (let from = 0; ; from += REPORT_DATA_PAGE_SIZE) {
    const { data, error } = await client
      .from("sales_records")
      .select("id,customer_id,transaction_date,amount,units,transaction_number,barcode,parent_sku,sku,product_class,master_style,color,size,catalog_color_name,style_number,raw_style_identifier,color_code,art_code,inventory_units,year_to_date_amount,year_to_date_units")
      .eq("customer_id", customerId)
      .order("transaction_date", { ascending: true })
      .range(from, from + REPORT_DATA_PAGE_SIZE - 1);

    if (error) return { records: [], error: error.message };
    records.push(...((data ?? []) as SalesRecord[]));
    if (!data || data.length < REPORT_DATA_PAGE_SIZE) break;
  }
  return { records, error: "" };
}

export async function fetchProductImages(client: SupabaseClient, customerId: string) {
  const { data } = await client
    .from("product_images")
    .select("style_number,art_code,color,product_url,image_url,storage_path")
    .eq("customer_id", customerId);
  return {
    images: ((data ?? []) as ProductImage[]).map((image) => ({
      ...image,
      resolved_url: storagePublicUrl(client, image.storage_path) ?? image.image_url,
    })),
  };
}

export async function fetchInventoryRecords(client: SupabaseClient, customerId: string) {
  const records: InventoryRecord[] = [];
  for (let from = 0; ; from += REPORT_DATA_PAGE_SIZE) {
    const { data, error } = await client
      .from("inventory_records")
      .select("id,customer_id,upload_id,inventory_date,source_file,product_class,master_style,color,size,raw_style_identifier,style_number,catalog_color_name,art_code,inventory_units,current_retail")
      .eq("customer_id", customerId)
      .order("inventory_date", { ascending: true })
      .range(from, from + REPORT_DATA_PAGE_SIZE - 1);

    if (error) return { records: [], error: error.message };
    records.push(...((data ?? []) as InventoryRecord[]));
    if (!data || data.length < REPORT_DATA_PAGE_SIZE) break;
  }
  return { records, error: "" };
}

export function storagePublicUrl(client: SupabaseClient, storagePath: string | null) {
  if (!storagePath) return null;
  return client.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}
