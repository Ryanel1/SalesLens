import fs from "node:fs";
import path from "node:path";

const appSupportDir = path.join(
  process.env.HOME,
  "Library",
  "Application Support",
  "SalesLens",
);
const recordsPath = path.join(appSupportDir, "sales-records.json");
const imageAssociationsPath = path.join(appSupportDir, "ProductImages", "associations.json");
const envPath = path.join(process.cwd(), ".env.import.local");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^"|"$/g, "");
    process.env[key] = process.env[key] ?? value;
  }
}

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compact(value) {
  if (value === undefined || value === null) return null;
  const string = String(value).trim();
  return string.length ? string : null;
}

function chunked(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function supabaseFetch(pathname, options = {}) {
  const url = `${supabaseUrl}${pathname}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${options.method ?? "GET"} ${pathname} failed: ${response.status} ${body}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function upsertRows(table, rows, conflictColumns, batchSize = 500) {
  let imported = 0;
  for (const chunk of chunked(rows, batchSize)) {
    await supabaseFetch(`/rest/v1/${table}?on_conflict=${conflictColumns}`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(chunk),
    });
    imported += chunk.length;
    process.stdout.write(`\r${table}: ${imported}/${rows.length}`);
  }
  process.stdout.write("\n");
}

loadEnv(envPath);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const shouldReplace = process.argv.includes("--replace");

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing required environment variables.");
  console.error(`Create ${envPath} with:`);
  console.error("NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co");
  console.error("SUPABASE_SERVICE_ROLE_KEY=your-service-role-key");
  process.exit(1);
}

if (!fs.existsSync(recordsPath)) {
  console.error(`Missing local SalesLens records file: ${recordsPath}`);
  process.exit(1);
}

const localRecords = JSON.parse(fs.readFileSync(recordsPath, "utf8"));
const customerNames = [...new Set(localRecords.map((record) => record.customerName).filter(Boolean))].sort();

console.log(`Found ${localRecords.length.toLocaleString()} local sales records.`);
console.log(`Customers: ${customerNames.join(", ")}`);

const customers = customerNames.map((name, index) => ({
  name,
  display_order: (index + 1) * 10,
}));

await upsertRows("customers", customers, "name", 100);

const remoteCustomers = await supabaseFetch(
  `/rest/v1/customers?select=id,name&name=in.(${customerNames.map(encodeURIComponent).join(",")})`,
);
const customerIdByName = new Map(remoteCustomers.map((customer) => [customer.name, customer.id]));

if (shouldReplace) {
  console.log("Replacing existing imported web records for local customers...");
  for (const name of customerNames) {
    const id = customerIdByName.get(name);
    if (!id) continue;
    await supabaseFetch(`/rest/v1/product_images?customer_id=eq.${id}`, { method: "DELETE" });
    await supabaseFetch(`/rest/v1/sales_records?customer_id=eq.${id}`, { method: "DELETE" });
  }
}

const salesRecords = localRecords.map((record) => {
  const customerId = customerIdByName.get(record.customerName);
  if (!customerId) {
    throw new Error(`No Supabase customer id for ${record.customerName}`);
  }

  return {
    id: record.id,
    customer_id: customerId,
    transaction_date: dateOnly(record.date),
    received_date: dateOnly(record.receivedDate),
    amount: numberOrNull(record.amount) ?? 0,
    units: numberOrNull(record.units),
    source_file: record.sourceFile,
    product_class: compact(record.productClass),
    master_style: compact(record.masterStyle),
    color: compact(record.color),
    size: compact(record.size),
    raw_style_identifier: compact(record.rawStyleIdentifier),
    style_number: compact(record.styleNumber),
    color_code: compact(record.colorCode),
    catalog_color_name: compact(record.catalogColorName),
    art_code: compact(record.artCode),
    last_received: dateOnly(record.lastReceived),
    current_retail: numberOrNull(record.currentRetail),
    year_to_date_amount: numberOrNull(record.yearToDateAmount),
    year_to_date_units: numberOrNull(record.yearToDateUnits),
    inventory_units: numberOrNull(record.inventoryUnits),
    inventory_retail_value: numberOrNull(record.inventoryRetailValue),
  };
});

await upsertRows("sales_records", salesRecords, "id", 500);

if (fs.existsSync(imageAssociationsPath)) {
  const associations = JSON.parse(fs.readFileSync(imageAssociationsPath, "utf8"));
  const rebelRagsId = customerIdByName.get("Rebel Rags") ?? null;
  const productImages = Object.values(associations).map((association) => ({
    customer_id: rebelRagsId,
    style_number: association.styleNumber,
    art_code: association.artCode,
    color: association.colorName,
    product_url: association.productURL,
    image_url: association.imageURL?.startsWith("file://") ? null : association.imageURL,
    storage_path: association.imageURL?.startsWith("file://") ? association.localFileName : null,
    is_manual_override: association.productURL === "local-manual-override",
    notes: association.lookupArtCode ? `Lookup art code: ${association.lookupArtCode}` : null,
  }));

  if (productImages.length > 0) {
    await upsertRows("product_images", productImages, "customer_id,style_number,art_code,color", 100);
  }
}

console.log("SalesLens local data import complete.");
