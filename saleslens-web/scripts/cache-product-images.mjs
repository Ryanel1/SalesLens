import fs from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const envPath = `${process.cwd()}/.env.import.local`;
const bucketName = "product-images";
const pageSize = 500;
const imageWidth = 720;
const imageQuality = 78;
const maxImageBytes = 8_000_000;

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

function normalized(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function slugPart(value) {
  return normalized(value).toLowerCase() || "unknown";
}

function storagePath(row) {
  const hash = createHash("sha1").update(row.image_url).digest("hex").slice(0, 8);
  return `${slugPart(row.customer_id)}/${slugPart(row.style_number)}/${slugPart(row.art_code)}/${slugPart(row.color)}-${hash}.webp`;
}

async function ensureBucket(supabase) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw error;

  const bucket = data?.find((item) => item.name === bucketName || item.id === bucketName);
  if (!bucket) {
    const { error: createError } = await supabase.storage.createBucket(bucketName, { public: true });
    if (createError) throw createError;
    return;
  }

  if (!bucket.public) {
    const { error: updateError } = await supabase.storage.updateBucket(bucketName, { public: true });
    if (updateError) throw updateError;
  }
}

async function fetchImageBytes(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "SalesLens/1.0 (product image backfill)" },
      signal: controller.signal,
    });
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!response.ok || !contentType.includes("image")) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > maxImageBytes) return null;
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

async function optimizeImage(bytes) {
  return sharp(bytes, { failOn: "none" })
    .rotate()
    .resize({
      width: imageWidth,
      height: imageWidth,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: imageQuality })
    .toBuffer();
}

async function loadRows(supabase) {
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("product_images")
      .select("id,customer_id,style_number,art_code,color,image_url,storage_path")
      .not("image_url", "is", null)
      .is("storage_path", null)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  return rows.filter((row) => row.image_url && !row.image_url.includes("/storage/v1/object/public/"));
}

loadEnv(envPath);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(`Missing env values. Create ${envPath} with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

await ensureBucket(supabase);

const rows = await loadRows(supabase);
let cached = 0;
let skipped = 0;

console.log(`Found ${rows.length.toLocaleString()} product images to cache.`);

for (const row of rows) {
  try {
    const bytes = await fetchImageBytes(row.image_url);
    if (!bytes) {
      skipped += 1;
      continue;
    }

    const optimized = await optimizeImage(bytes);
    const path = storagePath(row);

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(path, optimized, {
        cacheControl: "31536000",
        contentType: "image/webp",
        upsert: true,
      });

    if (uploadError) {
      skipped += 1;
      continue;
    }

    const { error: updateError } = await supabase
      .from("product_images")
      .update({ storage_path: path })
      .eq("id", row.id);

    if (updateError) {
      skipped += 1;
      continue;
    }

    cached += 1;
    process.stdout.write(`\rCached ${cached}/${rows.length} product images`);
  } catch {
    skipped += 1;
  }
}

process.stdout.write("\n");
console.log(`Done. Cached ${cached.toLocaleString()} images. Skipped ${skipped.toLocaleString()}.`);
