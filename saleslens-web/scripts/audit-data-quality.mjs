import fs from "node:fs";
import path from "node:path";

const PAGE_SIZE = 1000;
const env = loadEnv([".env.import.local", ".env.local"]);
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.import.local/.env.local.");
  process.exit(1);
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
};

const customers = await fetchRows("customers", "id,name,display_order", "", "display_order.asc");
const uploads = await fetchRows(
  "uploads",
  "id,customer_id,source_file,original_file_name,sales_period_start,sales_period_end,row_count,skipped_count,total_sales,total_units,status,created_at",
  "",
  "created_at.asc",
);
const salesRecords = await fetchRows(
  "sales_records",
  [
    "id",
    "customer_id",
    "upload_id",
    "transaction_date",
    "amount",
    "units",
    "transaction_number",
    "barcode",
    "parent_sku",
    "sku",
    "product_class",
    "master_style",
    "color",
    "catalog_color_name",
    "style_number",
    "raw_style_identifier",
    "art_code",
    "size",
    "source_file",
    "year_to_date_amount",
    "year_to_date_units",
  ].join(","),
  "",
  "transaction_date.asc",
);
const inventoryRecords = await fetchRows(
  "inventory_records",
  "id,customer_id,upload_id,inventory_date,source_file,product_class,style_number,raw_style_identifier,art_code,color,size,inventory_units,current_retail",
  "",
  "inventory_date.asc",
);

const customerById = new Map(customers.map((customer) => [customer.id, customer]));
const salesByCustomer = groupBy(salesRecords, (record) => record.customer_id);
const uploadsByCustomer = groupBy(uploads, (upload) => upload.customer_id);
const inventoryByCustomer = groupBy(inventoryRecords, (record) => record.customer_id);
const salesByUpload = groupBy(salesRecords, (record) => record.upload_id || "NO_UPLOAD");
const inventoryByUpload = groupBy(inventoryRecords, (record) => record.upload_id || "NO_UPLOAD");

console.log("\nSalesLens Data Quality Audit");
console.log(`Generated: ${new Date().toISOString()}`);
console.log(`Customers: ${customers.length}`);
console.log(`Sales rows: ${salesRecords.length.toLocaleString("en-US")}`);
console.log(`Inventory rows: ${inventoryRecords.length.toLocaleString("en-US")}`);
console.log(`Uploads: ${uploads.length.toLocaleString("en-US")}`);

for (const customer of customers) {
  const customerSales = salesByCustomer.get(customer.id) ?? [];
  const customerUploads = uploadsByCustomer.get(customer.id) ?? [];
  const customerInventory = inventoryByCustomer.get(customer.id) ?? [];
  printCustomerAudit(customer, customerSales, customerUploads, customerInventory);
}

function printCustomerAudit(customer, records, customerUploads, customerInventory) {
  console.log(`\n=== ${customer.name} ===`);
  if (!records.length && !customerInventory.length) {
    console.log("No sales or inventory rows.");
    return;
  }

  const sales = sum(records.map((record) => numberValue(record.amount)));
  const units = sum(records.map((record) => numberValue(record.units)));
  const dateRange = range(records.map((record) => record.transaction_date).filter(Boolean));
  const receiptKeys = unique(records.map(transactionKey).filter(Boolean));
  const productLineKeys = unique(records.map(productLineKey).filter(Boolean));
  const missingTransactionNumber = records.filter((record) => !clean(record.transaction_number)).length;
  const missingProductIdentity = records.filter((record) => !productLineKey(record)).length;
  const zeroAmountNonzeroUnits = records.filter((record) => numberValue(record.amount) === 0 && numberValue(record.units) !== 0);
  const nonzeroAmountZeroUnits = records.filter((record) => numberValue(record.amount) !== 0 && numberValue(record.units) === 0);

  console.log(`Sales rows: ${records.length.toLocaleString("en-US")} (${dateRange || "no dates"})`);
  console.log(`Sales / units: ${currency(sales)} / ${units.toLocaleString("en-US")}`);
  console.log(`Receipt IDs: ${receiptKeys.size.toLocaleString("en-US")} unique; missing on ${percent(missingTransactionNumber, records.length)} of rows`);
  console.log(`Product-line keys: ${productLineKeys.size.toLocaleString("en-US")} unique; missing on ${percent(missingProductIdentity, records.length)} of rows`);
  console.log(`Inventory rows: ${customerInventory.length.toLocaleString("en-US")}`);

  printMonthlySummary(records);
  printUploadReconciliation(customerUploads);
  printDuplicateSummary(records);

  if (zeroAmountNonzeroUnits.length) {
    console.log(`Warning: ${zeroAmountNonzeroUnits.length.toLocaleString("en-US")} rows have $0 sales with non-zero units.`);
  }
  if (nonzeroAmountZeroUnits.length) {
    console.log(`Warning: ${nonzeroAmountZeroUnits.length.toLocaleString("en-US")} rows have sales dollars with 0 units.`);
  }
}

function printMonthlySummary(records) {
  const monthGroups = groupBy(records, (record) => monthKey(record.transaction_date) || "NO_MONTH");
  const months = [...monthGroups.keys()].sort();
  if (!months.length) return;

  console.log("Month summary:");
  for (const month of months) {
    const group = monthGroups.get(month) ?? [];
    const sales = sum(group.map((record) => numberValue(record.amount)));
    const units = sum(group.map((record) => numberValue(record.units)));
    const receipts = unique(group.map(transactionKey).filter(Boolean)).size;
    const productLines = unique(group.map(productLineKey).filter(Boolean)).size;
    const uploads = unique(group.map((record) => record.upload_id).filter(Boolean)).size;
    console.log(
      `  ${month}: rows ${group.length.toLocaleString("en-US")}, sales ${currency(sales)}, units ${units.toLocaleString("en-US")}, receipts ${receipts.toLocaleString("en-US")}, product-lines ${productLines.toLocaleString("en-US")}, uploads ${uploads}`,
    );
  }
}

function printUploadReconciliation(customerUploads) {
  if (!customerUploads.length) return;
  const mismatches = [];
  const duplicateWindows = new Map();

  for (const upload of customerUploads) {
    const rows = salesByUpload.get(upload.id) ?? inventoryByUpload.get(upload.id) ?? [];
    const sales = sum(rows.map((record) => numberValue(record.amount)));
    const units = sum(rows.map((record) => numberValue(record.units ?? record.inventory_units)));
    const rowDelta = rows.length - numberValue(upload.row_count);
    const salesDelta = roundMoney(sales - numberValue(upload.total_sales));
    const unitsDelta = units - numberValue(upload.total_units);

    if (rowDelta || Math.abs(salesDelta) > 0.01 || unitsDelta) {
      mismatches.push({ upload, rows: rows.length, rowDelta, salesDelta, unitsDelta });
    }

    const windowKey = [
      upload.sales_period_start || "",
      upload.sales_period_end || "",
      compactKey(upload.source_file || upload.original_file_name),
      upload.status || "",
    ].join("|");
    duplicateWindows.set(windowKey, [...(duplicateWindows.get(windowKey) ?? []), upload]);
  }

  console.log(`Uploads: ${customerUploads.length.toLocaleString("en-US")}`);
  if (mismatches.length) {
    console.log(`Upload mismatches: ${mismatches.length.toLocaleString("en-US")}`);
    for (const mismatch of mismatches.slice(0, 8)) {
      console.log(
        `  ${mismatch.upload.original_file_name}: rows ${mismatch.rows}/${mismatch.upload.row_count}, sales delta ${currency(mismatch.salesDelta)}, units delta ${mismatch.unitsDelta}`,
      );
    }
  } else {
    console.log("Upload reconciliation: row/sales/unit totals match saved rows.");
  }

  const repeats = [...duplicateWindows.values()].filter((group) => group.length > 1);
  if (repeats.length) {
    console.log(`Repeated upload windows/files: ${repeats.length.toLocaleString("en-US")}`);
    for (const group of repeats.slice(0, 5)) {
      const first = group[0];
      console.log(
        `  ${first.original_file_name}: ${group.length} uploads for ${first.sales_period_start || "?"} to ${first.sales_period_end || "?"}`,
      );
    }
  }
}

function printDuplicateSummary(records) {
  const keys = groupBy(records, recordKey);
  const duplicates = [...keys.entries()].filter(([, group]) => group.length > 1);
  if (!duplicates.length) {
    console.log("Duplicate record keys: none detected by app-level key.");
    return;
  }

  const duplicateRows = sum(duplicates.map(([, group]) => group.length - 1));
  console.log(`Duplicate record keys: ${duplicates.length.toLocaleString("en-US")} keys, ${duplicateRows.toLocaleString("en-US")} extra rows.`);
  for (const [, group] of duplicates.slice(0, 8)) {
    const first = group[0];
    console.log(
      `  ${first.transaction_date} ${first.product_class || ""} ${first.style_number || first.raw_style_identifier || ""} ${first.art_code || ""} ${first.catalog_color_name || first.color || ""}: ${group.length} rows`,
    );
  }
}

async function fetchRows(table, select, filter = "", order = "") {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const params = new URLSearchParams();
    params.set("select", select);
    if (order) params.set("order", order);
    const url = `${supabaseUrl}/rest/v1/${table}?${params.toString()}${filter ? `&${filter}` : ""}`;
    const response = await fetch(url, {
      headers: {
        ...headers,
        Range: `${from}-${from + PAGE_SIZE - 1}`,
        Prefer: "count=exact",
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${table}: ${response.status} ${text}`);
    const page = text ? JSON.parse(text) : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function transactionKey(record) {
  const transactionNumber = compactKey(record.transaction_number);
  if (!transactionNumber) return "";
  return `${record.transaction_date}|${transactionNumber}`;
}

function productLineKey(record) {
  const key = [
    compactKey(record.parent_sku),
    compactKey(record.sku),
    compactKey(record.style_number),
    compactKey(record.art_code),
    compactKey(record.raw_style_identifier),
    compactKey(record.catalog_color_name ?? record.color),
    compactKey(record.size),
  ].join("|");
  return key.replace(/\|/g, "") ? key : "";
}

function recordKey(record) {
  const transactionIdentity = compactKey(record.transaction_number) || compactKey(record.barcode);
  return [
    record.transaction_date,
    transactionIdentity,
    numberValue(record.amount).toFixed(2),
    record.units ?? "",
    compactKey(record.style_number),
    compactKey(record.art_code),
    compactKey(record.catalog_color_name ?? record.color),
    compactKey(record.size),
    compactKey(record.master_style),
    compactKey(record.raw_style_identifier),
  ].join("|");
}

function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function unique(items) {
  return new Set(items);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function numberValue(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clean(value) {
  const cleaned = String(value ?? "").trim();
  return cleaned ? cleaned : "";
}

function compactKey(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function monthKey(value) {
  return typeof value === "string" && value.length >= 7 ? value.slice(0, 7) : "";
}

function range(values) {
  if (!values.length) return "";
  const sorted = [...values].sort();
  return `${sorted[0]} to ${sorted.at(-1)}`;
}

function percent(count, total) {
  if (!total) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function currency(value) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function loadEnv(files) {
  const result = {};
  for (const file of files) {
    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      result[key] = value;
    }
  }
  return { ...result, ...process.env };
}
