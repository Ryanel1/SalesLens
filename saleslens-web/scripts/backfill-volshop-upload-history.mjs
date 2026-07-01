import fs from "node:fs";
import path from "node:path";

const BACKUP_DIR = path.resolve(process.cwd(), "data-backups");
const PAGE_SIZE = 1000;
const UPDATE_CHUNK_SIZE = 150;

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

const existingUploads = await fetchRows(
  "uploads",
  "id,customer_id,source_file,original_file_name,received_date,sales_period_start,sales_period_end,row_count,skipped_count,total_sales,total_units,status,created_at",
  `customer_id=eq.${volshop.id}`,
  "sales_period_end.desc.nullslast,sales_period_start.desc.nullslast,created_at.desc",
);

const unassignedRecords = await fetchRows(
  "sales_records",
  [
    "id",
    "customer_id",
    "upload_id",
    "transaction_date",
    "received_date",
    "amount",
    "units",
    "source_file",
  ].join(","),
  `customer_id=eq.${volshop.id}&upload_id=is.null`,
  "transaction_date.asc,source_file.asc,id.asc",
);

const groups = [...groupBy(unassignedRecords, uploadGroupKey).values()]
  .map(buildGroupSummary)
  .sort((left, right) => left.salesPeriodStart.localeCompare(right.salesPeriodStart) || left.sourceFile.localeCompare(right.sourceFile));

const existingUploadByWindow = new Map(existingUploads.map((upload) => [uploadWindowKey(upload), upload]));
const plannedGroups = groups.map((group) => {
  const existingUpload = existingUploadByWindow.get(uploadWindowKey({
    source_file: group.sourceFile,
    sales_period_start: group.salesPeriodStart,
    sales_period_end: group.salesPeriodEnd,
  }));
  return {
    ...group,
    action: existingUpload ? "reuse-existing-upload" : "create-upload",
    uploadId: existingUpload?.id ?? null,
  };
});

const backup = {
  generated_at: new Date().toISOString(),
  mode: apply ? "apply" : "dry-run",
  customer: volshop,
  existing_uploads: existingUploads,
  planned_groups: plannedGroups,
  unassigned_sales_records: unassignedRecords,
  totals: {
    existing_uploads: existingUploads.length,
    new_uploads: plannedGroups.filter((group) => group.action === "create-upload").length,
    reused_uploads: plannedGroups.filter((group) => group.action === "reuse-existing-upload").length,
    sales_records_to_attach: unassignedRecords.length,
    sales: roundMoney(sum(unassignedRecords.map((record) => numberValue(record.amount)))),
    units: sum(unassignedRecords.map((record) => numberValue(record.units))),
  },
};

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const backupPath = path.join(BACKUP_DIR, `volshop-upload-history-backfill-${timestamp()}.json`);
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

console.log(`Volshop upload history backfill ${apply ? "(APPLY)" : "(DRY RUN)"}`);
console.log(`Existing Volshop uploads: ${existingUploads.length.toLocaleString("en-US")}`);
console.log(`Unassigned Volshop sales rows: ${unassignedRecords.length.toLocaleString("en-US")}`);
console.log(`Planned upload groups: ${plannedGroups.length.toLocaleString("en-US")}`);
console.log(`Rows / sales / units to attach: ${unassignedRecords.length.toLocaleString("en-US")} / ${currency(backup.totals.sales)} / ${backup.totals.units.toLocaleString("en-US")}`);
console.log(`Backup written: ${backupPath}`);
console.log("");

for (const group of plannedGroups) {
  console.log(
    [
      group.action === "create-upload" ? "CREATE" : "REUSE ",
      group.sourceFile,
      `${group.salesPeriodStart} to ${group.salesPeriodEnd}`,
      `${group.rowCount.toLocaleString("en-US")} rows`,
      `${group.totalUnits.toLocaleString("en-US")} units`,
      currency(group.totalSales),
    ].join(" | "),
  );
}

if (!plannedGroups.length) {
  console.log("No missing Volshop upload history found.");
  process.exit(0);
}

if (!apply) {
  console.log("");
  console.log("No database changes made. Re-run with --apply to create upload rows and attach existing sales records.");
  process.exit(0);
}

let createdUploads = 0;
let reusedUploads = 0;
let updatedRecords = 0;

for (const group of plannedGroups) {
  let uploadId = group.uploadId;
  if (!uploadId) {
    uploadId = await createUpload(group);
    createdUploads += 1;
  } else {
    reusedUploads += 1;
    await updateUploadTotals(uploadId, group);
  }

  for (const ids of chunks(group.recordIds, UPDATE_CHUNK_SIZE)) {
    updatedRecords += await updateSalesRecordUploadIds(ids, uploadId);
  }
}

console.log("");
console.log("Backfill complete.");
console.log(`Created uploads: ${createdUploads.toLocaleString("en-US")}`);
console.log(`Reused uploads: ${reusedUploads.toLocaleString("en-US")}`);
console.log(`Updated sales records: ${updatedRecords.toLocaleString("en-US")}`);

function buildGroupSummary(records) {
  const first = records[0];
  const salesPeriodStart = first.transaction_date;
  return {
    sourceFile: clean(first.source_file) || `Volshop ${salesPeriodStart}`,
    salesPeriodStart,
    salesPeriodEnd: monthEnd(salesPeriodStart),
    receivedDate: latest(records.map((record) => record.received_date).filter(Boolean)) ?? monthEnd(salesPeriodStart),
    rowCount: records.length,
    skippedCount: 0,
    totalSales: roundMoney(sum(records.map((record) => numberValue(record.amount)))),
    totalUnits: sum(records.map((record) => numberValue(record.units))),
    recordIds: records.map((record) => record.id),
  };
}

function uploadGroupKey(record) {
  return [record.transaction_date, clean(record.source_file)].join("|");
}

function uploadWindowKey(upload) {
  return [
    clean(upload.source_file || upload.original_file_name),
    clean(upload.sales_period_start),
    clean(upload.sales_period_end),
  ].join("|");
}

async function createUpload(group) {
  const body = {
    customer_id: volshop.id,
    source_file: group.sourceFile,
    original_file_name: group.sourceFile,
    received_date: group.receivedDate,
    sales_period_start: group.salesPeriodStart,
    sales_period_end: group.salesPeriodEnd,
    row_count: group.rowCount,
    skipped_count: group.skippedCount,
    total_sales: group.totalSales,
    total_units: group.totalUnits,
    status: "imported",
  };
  const inserted = await requestJson("uploads", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body,
  });
  const uploadId = inserted?.[0]?.id;
  if (!uploadId) throw new Error(`Upload insert did not return an id for ${group.sourceFile}.`);
  return uploadId;
}

async function updateUploadTotals(uploadId, group) {
  await requestJson(`uploads?id=eq.${uploadId}&customer_id=eq.${volshop.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: {
      received_date: group.receivedDate,
      row_count: group.rowCount,
      skipped_count: group.skippedCount,
      total_sales: group.totalSales,
      total_units: group.totalUnits,
      status: "imported",
    },
  });
}

async function updateSalesRecordUploadIds(ids, uploadId) {
  const updated = await requestJson(`sales_records?id=in.(${ids.join(",")})&customer_id=eq.${volshop.id}&upload_id=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: { upload_id: uploadId },
  });
  return updated.length;
}

async function fetchRows(table, select, filter = "", order = "") {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const params = new URLSearchParams();
    params.set("select", select);
    if (order) params.set("order", order);
    const separator = params.toString() ? "&" : "";
    const url = `${supabaseUrl}/rest/v1/${table}?${params.toString()}${filter ? `${separator}${filter}` : ""}`;
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

async function requestJson(pathAndQuery, options) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
    method: options.method,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathAndQuery}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : [];
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

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function monthEnd(date) {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function latest(values) {
  return values.length ? [...values].sort().at(-1) : null;
}

function clean(value) {
  return String(value ?? "").trim();
}

function numberValue(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function currency(value) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}
