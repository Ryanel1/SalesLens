const fs = require("fs");

const env = Object.fromEntries(
  fs
    .readFileSync("saleslens-web/.env.import.local", "utf8")
    .split(/\n/)
    .filter(Boolean)
    .filter((line) => !line.trim().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
    }),
);

const base = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function get(path) {
  const response = await fetch(base + path, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return JSON.parse(text);
}

async function getAll(table, query, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const sep = query.includes("?") ? "&" : "?";
    const page = await get(`${table}${query}${sep}limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function monthKey(date) {
  return String(date || "").slice(0, 7);
}

function amount(record) {
  return Number(record.amount || record.sales_amount || 0) || 0;
}

function normalize(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const gearPrefixes = ["GDH", "G", "C400", "C603", "CBR", "S650", "G209"];

function brand(record) {
  const haystack = `${record.product_class || ""} ${record.master_style || ""} ${record.style_number || ""}`.toUpperCase();
  const style = normalize(record.style_number || record.raw_style_identifier || record.master_style);
  if (
    haystack.includes("GEAR") ||
    haystack.includes("COMFORT WASH") ||
    gearPrefixes.some((prefix) => style.startsWith(prefix))
  ) {
    return "Gear";
  }
  return "Champion";
}

function byMonth(rows, year) {
  return Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    return rows.filter((row) => monthKey(row.transaction_date) === key).reduce((sum, row) => sum + amount(row), 0);
  });
}

function ytd(rows, year, throughMonth) {
  return byMonth(rows, year)
    .slice(0, throughMonth)
    .reduce((sum, value) => sum + value, 0);
}

(async () => {
  const customer = (
    await get("/rest/v1/customers?select=id,name&name=eq.Rebel%20Rags")
  )[0];
  if (!customer) throw new Error("Rebel Rags customer not found");

  const records = await getAll(
    "/rest/v1/sales_records",
    `?select=id,upload_id,transaction_date,amount,units,product_class,master_style,style_number,raw_style_identifier,art_code,color&customer_id=eq.${customer.id}&transaction_date=gte.2025-01-01&transaction_date=lte.2026-12-31`,
  );

  const groups = {
    All: records,
    Champion: records.filter((record) => brand(record) === "Champion"),
    Gear: records.filter((record) => brand(record) === "Gear"),
  };

  const lines = [`Rebel Rags live sales records checked: ${records.length}`];
  for (const [label, rows] of Object.entries(groups)) {
    const months2026 = byMonth(rows, 2026);
    const months2025 = byMonth(rows, 2025);
    lines.push("");
    lines.push(label);
    lines.push(`  2026 Jan-Jun monthly: ${months2026.slice(0, 6).map(money).join(" | ")}`);
    lines.push(`  2025 Jan-Jun monthly: ${months2025.slice(0, 6).map(money).join(" | ")}`);
    lines.push(`  2026 Jan-Jun YTD: ${money(ytd(rows, 2026, 6))}`);
    lines.push(`  2025 Jan-Jun YTD: ${money(ytd(rows, 2025, 6))}`);
    lines.push(`  Delta: ${money(ytd(rows, 2026, 6) - ytd(rows, 2025, 6))}`);
  }

  const uploads = await getAll(
    "/rest/v1/uploads",
    `?select=id,original_file_name,sales_period_start,sales_period_end,row_count,total_sales,status,created_at&customer_id=eq.${customer.id}&created_at=gte.2025-01-01&order=created_at.asc`,
  );

  lines.push("");
  lines.push(`Uploads checked: ${uploads.length}`);
  const duplicateGroups = new Map();
  for (const upload of uploads) {
    const key = [
      upload.original_file_name,
      upload.sales_period_start,
      upload.sales_period_end,
      upload.total_sales,
    ].join("|");
    duplicateGroups.set(key, [...(duplicateGroups.get(key) || []), upload]);
  }
  const duplicates = [...duplicateGroups.values()].filter((group) => group.length > 1);
  if (!duplicates.length) {
    lines.push("  No exact duplicate upload groups found.");
  } else {
    lines.push(`  Exact duplicate upload groups found: ${duplicates.length}`);
    for (const group of duplicates) {
      const upload = group[0];
      lines.push(
        `  x${group.length} ${upload.original_file_name} ${upload.sales_period_start || "-"}..${
          upload.sales_period_end || "-"
        } ${money(upload.total_sales)} statuses=${group.map((item) => item.status).join(",")}`,
      );
    }
  }

  console.log(lines.join("\n"));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
