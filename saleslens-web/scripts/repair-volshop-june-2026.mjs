import fs from "node:fs";
import path from "node:path";

const BAD_UPLOAD_NAMES = new Set(["volshop ccp june 1-16 2026.xlsx"]);
const BAD_UPLOAD_START = "2016-05-01";
const BAD_UPLOAD_END = "2016-05-01";
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

const volshop = (await fetchRows("customers", "id,name", "name=eq.Volshop"))[0];
if (!volshop) throw new Error("Could not find Volshop customer.");

const uploads = await fetchRows(
  "uploads",
  "id,customer_id,source_file,original_file_name,sales_period_start,sales_period_end,row_count,skipped_count,total_sales,total_units,status,created_at",
  [
    `customer_id=eq.${volshop.id}`,
    `sales_period_start=eq.${BAD_UPLOAD_START}`,
    `sales_period_end=eq.${BAD_UPLOAD_END}`,
  ].join("&"),
  "created_at.asc",
);

const badUploads = uploads.filter((upload) => BAD_UPLOAD_NAMES.has(upload.original_file_name || upload.source_file || ""));
const uploadIds = badUploads.map((upload) => upload.id);
const records = uploadIds.length
  ? await fetchRows(
      "sales_records",
      "*",
      uploadIds.map((uploadId) => `upload_id.eq.${uploadId}`).join(","),
      "transaction_date.asc",
      true,
    )
  : [];

const backup = {
  generated_at: new Date().toISOString(),
  mode: apply ? "apply" : "dry-run",
  customer: volshop,
  bad_uploads: badUploads,
  sales_records: records,
  totals: {
    uploads: badUploads.length,
    sales_records: records.length,
    sales: roundMoney(sum(records.map((record) => Number(record.amount ?? 0)))),
    units: sum(records.map((record) => Number(record.units ?? 0))),
  },
};

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const backupPath = path.join(BACKUP_DIR, `volshop-bad-2016-june-backup-${timestamp()}.json`);
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

console.log(`Volshop bad upload repair ${apply ? "(APPLY)" : "(DRY RUN)"}`);
console.log(`Matched uploads: ${badUploads.length}`);
for (const upload of badUploads) {
  console.log(`- ${upload.id} ${upload.original_file_name} ${upload.sales_period_start} to ${upload.sales_period_end}`);
}
console.log(`Matched sales records: ${records.length}`);
console.log(`Matched sales: ${currency(backup.totals.sales)} / units ${backup.totals.units.toLocaleString("en-US")}`);
console.log(`Backup written: ${backupPath}`);

if (!apply) {
  console.log("No database changes made. Re-run with --apply to delete these bad upload rows and upload records.");
  process.exit(0);
}

for (const uploadId of uploadIds) {
  await deleteRows("sales_records", `upload_id=eq.${uploadId}&customer_id=eq.${volshop.id}`);
  await deleteRows("uploads", `id=eq.${uploadId}&customer_id=eq.${volshop.id}`);
}

console.log("Deleted bad sales records and upload rows.");

async function fetchRows(table, select, filter = "", order = "", orFilter = false) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const params = new URLSearchParams();
    params.set("select", select);
    if (order) params.set("order", order);
    if (orFilter && filter) params.set("or", `(${filter})`);
    const separator = params.toString() ? "&" : "";
    const filterQuery = filter && !orFilter ? `${separator}${filter}` : "";
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
