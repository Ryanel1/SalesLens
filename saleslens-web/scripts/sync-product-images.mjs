import fs from "node:fs/promises";
import path from "node:path";

const appSupportDir = path.join(process.env.HOME, "Library", "Application Support", "SalesLens");
const productImagesDir = path.join(appSupportDir, "ProductImages");
const envPath = path.join(process.cwd(), ".env.import.local");
const bucketName = "product-images";

function loadEnv(filePath) {
  return fs
    .readFile(filePath, "utf8")
    .then((contents) => {
      for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const separator = trimmed.indexOf("=");
        if (separator === -1) continue;
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim().replace(/^"|"$/g, "");
        process.env[key] = process.env[key] ?? value;
      }
    })
    .catch(() => undefined);
}

function parseImageFileName(fileName) {
  const baseName = fileName.replace(/\.image$/i, "");
  const parts = baseName.split("_");
  if (parts.length < 3) return null;
  const [styleNumber, artCode, ...colorParts] = parts;
  return {
    styleNumber,
    artCode,
    color: colorParts.join(" "),
    storagePath: `rebel-rags/${baseName}.jpg`,
  };
}

async function supabaseFetch(supabaseUrl, serviceRoleKey, pathname, options = {}) {
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
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

async function ensurePublicBucket(supabaseUrl, serviceRoleKey) {
  const buckets = await supabaseFetch(supabaseUrl, serviceRoleKey, "/storage/v1/bucket");
  const bucket = buckets.find((item) => item.name === bucketName || item.id === bucketName);
  if (!bucket) {
    await supabaseFetch(supabaseUrl, serviceRoleKey, "/storage/v1/bucket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: bucketName,
        name: bucketName,
        public: true,
      }),
    });
    return;
  }

  if (!bucket.public) {
    await supabaseFetch(supabaseUrl, serviceRoleKey, `/storage/v1/bucket/${bucketName}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public: true,
      }),
    });
  }
}

async function main() {
  await loadEnv(envPath);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`Missing env values. Create ${envPath} with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  }

  await ensurePublicBucket(supabaseUrl, serviceRoleKey);

  const customers = await supabaseFetch(
    supabaseUrl,
    serviceRoleKey,
    "/rest/v1/customers?select=id&name=eq.Rebel%20Rags",
  );
  const rebelRags = customers[0];
  if (!rebelRags) throw new Error("Could not find Rebel Rags customer in Supabase.");

  const files = (await fs.readdir(productImagesDir)).filter((fileName) => fileName.toLowerCase().endsWith(".image"));
  let synced = 0;
  let skipped = 0;

  for (const fileName of files) {
    const parsed = parseImageFileName(fileName);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const bytes = await fs.readFile(path.join(productImagesDir, fileName));
    await supabaseFetch(
      supabaseUrl,
      serviceRoleKey,
      `/storage/v1/object/${bucketName}/${parsed.storagePath}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          "x-upsert": "true",
        },
        body: bytes,
      },
    );

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${parsed.storagePath}`;

    await supabaseFetch(
      supabaseUrl,
      serviceRoleKey,
      "/rest/v1/product_images?on_conflict=customer_id,style_number,art_code,color",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          customer_id: rebelRags.id,
          style_number: parsed.styleNumber,
          art_code: parsed.artCode,
          color: parsed.color,
          image_url: publicUrl,
          storage_path: parsed.storagePath,
          is_manual_override: false,
          notes: "Synced from local SalesLens product image cache",
        }),
      },
    );

    synced += 1;
    process.stdout.write(`\rSynced ${synced}/${files.length} product images`);
  }

  process.stdout.write("\n");
  console.log(`Done. Synced ${synced} images. Skipped ${skipped}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
