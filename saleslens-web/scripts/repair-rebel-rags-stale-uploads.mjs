import fs from "node:fs";
import path from "node:path";

const BACKUP_DIR = path.resolve(process.cwd(), "data-backups");
const PAGE_SIZE = 1000;

const apply = process.argv.includes("--apply");
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

const rebelRags = (await fetchRows("customers", "id,name", "name=eq.Rebel%20Rags"))[0];
if (!rebelRags) throw new Error("Could not find Rebel Rags customer.");

const uploads = await fetchRows(
  "uploads",
  "id,customer_id,source_file,original_file_name,sales_period_start,sales_period_end,row_count,skipped_count,total_sales,total_units,status,created_at",
  `customer_id=eq.${rebelRags.id}`,
  "created_at.asc,id.asc",
);
const salesRecords = await fetchRows(
  "sales_records",
  "id,upload_id,transaction_date,amount,units,source_file,product_class,style_number,art_code,color,catalog_color_name,transaction_number",
  `customer_id=eq.${rebelRags.id}`,
  "transaction_date.asc,id.asc",
);
const inventoryRecords = await fetchRows(
  "inventory_records",
  "id,upload_id,inventory_date,source_file,product_class,style_number,art_code,color,inventory_units,current_retail",
  `customer_id=eq.${rebelRags.id}`,
  "inventory_date.asc,id.asc",
);

const salesByUpload = groupBy(salesRecords, (record) => record.upload_id || "NO_UPLOAD");
const inventoryByUpload = groupBy(inventoryRecords, (record) => record.upload_id || "NO_UPLOAD");
const staleUploads = uploads.filter((upload) => {
  const salesCount = salesByUpload.get(upload.id)?.length ?? 0;
  const inventoryCount = inventoryByUpload.get(upload.id)?.length ?? 0;
  return salesCount + inventoryCount === 0;
});

const backup = {
  generated_at: new Date().toISOString(),
  mode: apply ? "apply" : "dry-run",
  customer: rebelRags,
  stale_uploads: staleUploads,
  totals: {
    stale_uploads: staleUploads.length,
    historical_row_count: sum(staleUploads.map((upload) => Number(upload.row_count ?? 0))),
    historical_sales: roundMoney(sum(staleUploads.map((upload) => Number(upload.total_sales ?? 0)))),
    historical_units: sum(staleUploads.map((upload) => Number(upload.total_units ?? 0))),
  },
};

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const backupPath = path.join(BACKUP_DIR, `rebel-rags-stale-uploads-backup-${timestamp()}.json`);
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

console.log(`Rebel Rags stale upload repair ${apply ? "(APPLY)" : "(DRY RUN)"}`);
console.log(`Matched stale uploads: ${staleUploads.length}`);
for (const upload of staleUploads) {
  console.log(
    `- ${upload.id} ${upload.original_file_name || upload.source_file} ${upload.sales_period_start || "?"} to ${upload.sales_period_end || "?"} rows ${upload.row_count}`,
  );
}
console.log(`Historical upload totals: ${backup.totals.historical_row_count.toLocaleString("en-US")} rows, ${currency(backup.totals.historical_sales)}, ${backup.totals.historical_units.toLocaleString("en-US")} units`);
console.log(`Backup written: ${backupPath}`);

if (!apply) {
  console.log("No database changes made. Re-run with --apply to delete these stale upload rows.");
  process.exit(0);
}

for (const upload of staleUploads) {
  await deleteRows("uploads", `id=eq.${upload.id}&customer_id=eq.${rebelRags.id}`);
}

console.log("Deleted stale Rebel Rags upload rows.");

async function fetchRows(table, select, filter = "", order = "") {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const params = new URLSearchParams();
    params.set("select", select);
    if (order) params.set("order", order);
    const separator = params.toString() ? "&" : "";
    const filterQuery = filter ? `${separator}${filter}` : "";
    const url = `${supabaseUrl}/rest/v1/${table}?${params.toString()}${filterQuery}`;
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

async function deleteRows(table, filter) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: {
      ...headers,
      Prefer: "return=representation",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table}: ${response.status} ${text}`);
  const deleted = text ? JSON.parse(text) : [];
  console.log(`Deleted ${deleted.length} ${table} rows.`);
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

function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function currency(value) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}
