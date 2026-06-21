import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";

type ImageRequestItem = {
  style?: string;
  artCode?: string;
  color?: string;
  styleName?: string;
  parentSku?: string;
  sku?: string;
};

type ProductImageLookup = {
  searchArtCode: string;
  isManualOverride: boolean;
  productUrl: string | null;
};

type ProductImageMatch = {
  style: string;
  artCode: string;
  color: string;
  productUrl: string;
  imageUrl: string;
  sourceImageUrl: string;
  storagePath: string | null;
  lookupArtCode: string;
  isManualOverride: boolean;
};

const REBEL_RAGS_BASE_URL = "https://www.rebelrags.net";
const VOLSHOP_BASE_URL = "https://www.utvolshop.com";
const MAX_LOOKUPS = 30;
const PRODUCT_IMAGE_BUCKET = "product-images";
const PRODUCT_IMAGE_CACHE_WIDTH = 720;
const PRODUCT_IMAGE_CACHE_QUALITY = 78;
const PRODUCT_IMAGE_CACHE_MAX_BYTES = 8_000_000;
const GEAR_STYLE_PREFIXES = ["GDH", "G", "C400", "C603", "S650", "G209"];
const REBEL_RAGS_NAMEDROP_CT1000_LOOKUPS: Record<string, { productCode: string; productUrl: string }> = {
  "03503316": namedropLookup("AUNT-03687238-CT1000", "/champion/script-ole-miss-aunt-ss-tee-25809"),
  "03503317": namedropLookup("UNCLE-03503317-CT1000", "/champion/ss-script-ole-miss-uncle-basic-tee-22192"),
  "03503347": namedropLookup("LAW-03503347-CT1000", "/champion/script-ole-miss-law-ss-tee-25888"),
  "03503350": namedropLookup("SB-CT1000-03503350", "/champion/script-ole-miss-softball-basic-tee-22276"),
  "03503351": namedropLookup("TEN-03503351-CT1000", "/champion/ss-script-ole-miss-tennis-basic-tee-22196"),
  "03503432": namedropLookup("ALUMNI-03503432-CT1000", "/champion/script-ole-miss-alumni-ss-tee-25807"),
  "03661320": namedropLookup("SIS-03661320-CT1000", "/champion/sister-ole-miss-script-ss-tee-24922"),
  "03687238": namedropLookup("AUNT-03687238-CT1000", "/champion/script-ole-miss-aunt-ss-tee-25809"),
  "03687242": namedropLookup("DAD-03687242-CT1000", "/champion/script-ole-miss-dad-ss-tee-25814"),
  "03687254": namedropLookup("MOM-03687254-CT1000", "/champion/script-ole-miss-mom-ss-tee-25816"),
  "03687256": namedropLookup("PHARM-03687256-CT1000", "/champion/script-ole-miss-pharmacy-ss-tee-25889"),
  "03687276": namedropLookup("VB-03687276-CT1000", "/champion/script-ole-miss-volleyball-ss-basic-tee-22346"),
  "03687288": namedropLookup("WBB-03687288-CT1000", "/champion/script-ole-miss-womens-basketball-ss-tee-25822"),
  "03751856": namedropLookup("AUNT-03687238-CT1000", "/champion/script-ole-miss-aunt-ss-tee-25809"),
  "03751860": namedropLookup("NURSE-03491635-CT1000", "/champion/ss-basic-ole-miss-script-nursing-tee-21820"),
  "03751861": namedropLookup("PHARM-03687256-CT1000", "/champion/script-ole-miss-pharmacy-ss-tee-25889"),
  "03751866": namedropLookup("SB-CT1000-03503350", "/champion/script-ole-miss-softball-basic-tee-22276"),
  "03751911": namedropLookup("ED-03751911-CT1000", "/champion/script-ole-miss-education-ss-basic-tee-22179"),
  "03751916": namedropLookup("GPA-03751916-CT1000", "/champion/ss-script-ole-miss-grandpa-tee-26938"),
  "03751966": namedropLookup("HOCKEY-CT1000-03751966", "/champion/ss-script-ole-miss-hockey-tee-26919"),
  "03752042": namedropLookup("UNCLE-03503317-CT1000", "/champion/ss-script-ole-miss-uncle-basic-tee-22192"),
  "03804603": namedropLookup("DAD-03687242-CT1000", "/champion/script-ole-miss-dad-ss-tee-25814"),
  "03804605": namedropLookup("VB-03687276-CT1000", "/champion/script-ole-miss-volleyball-ss-basic-tee-22346"),
  "03854968": namedropLookup("ALUMNI-03503432-CT1000", "/champion/script-ole-miss-alumni-ss-tee-25807"),
  "03884278": namedropLookup("03884278-CT1000", "/champion/script-ole-miss-soccer-ss-tee-27993"),
};

export async function POST(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const accountName = clean(body?.accountName);
  const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_LOOKUPS) as ImageRequestItem[] : [];
  const matches: ProductImageMatch[] = [];
  const storageClient = storageAdminClient(config.supabaseUrl);
  const canCacheImages = storageClient ? await ensureProductImageBucket(storageClient).catch(() => false) : false;

  for (const item of items) {
    const match = await matchingImage(item, accountName).catch(() => null);
    if (!match) continue;

    if (storageClient && canCacheImages) {
      const cachedImage = await cacheProductImage(storageClient, match, accountName).catch(() => null);
      if (cachedImage) {
        matches.push({
          ...match,
          imageUrl: cachedImage.publicUrl,
          storagePath: cachedImage.storagePath,
        });
        continue;
      }
    }

    matches.push(match);
  }

  return NextResponse.json({ matches });
}

async function matchingImage(item: ImageRequestItem, accountName: string): Promise<ProductImageMatch | null> {
  const style = clean(item.style);
  const artCode = clean(item.artCode);
  const color = clean(item.color);

  if (!style || !artCode || !color) return null;

  if (isVolshopAccount(accountName)) {
    const volshopImage = await matchingVolshopImage(item);
    if (volshopImage) {
      return {
        style,
        artCode,
        color,
        productUrl: volshopImage.productUrl,
        imageUrl: volshopImage.imageUrl,
        sourceImageUrl: volshopImage.imageUrl,
        storagePath: null,
        lookupArtCode: volshopImage.lookupValue,
        isManualOverride: false,
      };
    }
    return null;
  }

  const lookup = imageLookup(item);
  const fallbackProductUrls = await productDetailUrlsForItem(item, lookup.searchArtCode);
  const productUrls = lookup.productUrl ? [lookup.productUrl, ...fallbackProductUrls] : fallbackProductUrls;
  const manualProductUrl = lookup.productUrl;

  for (const productUrl of productUrls.slice(0, 50)) {
    const detailHtml = await fetchText(productUrl).catch(() => "");
    if (!detailHtml) continue;

    if (productUrl !== manualProductUrl && !detailMatches(detailHtml, item, lookup.searchArtCode, productUrl)) {
      continue;
    }

    const imageUrl = productImageUrl(detailHtml, item, productUrl);
    if (!imageUrl) continue;

    return {
      style,
      artCode,
      color,
      productUrl,
      imageUrl,
      sourceImageUrl: imageUrl,
      storagePath: null,
      lookupArtCode: lookup.searchArtCode,
      isManualOverride: lookup.isManualOverride,
    };
  }

  return null;
}

async function matchingVolshopImage(item: ImageRequestItem) {
  const knownUrl = knownVolshopProductImageUrl(item);
  const parentSku = volshopSku(item.parentSku);
  const sku = volshopSku(item.sku);
  const lookupValue = parentSku || sku;
  const searchKeywords = [parentSku, sku, clean(item.style), clean(item.artCode)].filter(Boolean) as string[];

  for (const keyword of searchKeywords) {
    const productUrls = await volshopProductDetailUrlsForKeyword(keyword);
    for (const productUrl of productUrls.slice(0, 12)) {
      const detailHtml = await fetchText(productUrl).catch(() => "");
      if (!detailHtml) continue;
      if (!volshopDetailMatches(detailHtml, item, keyword)) continue;
      const imageUrl = volshopImageFromDetail(detailHtml, productUrl);
      if (imageUrl) return { imageUrl, productUrl, lookupValue: keyword };
    }
  }

  for (const keyword of [parentSku, sku].filter(Boolean) as string[]) {
    const searchImage = await volshopImageFromSearchKeyword(keyword);
    if (searchImage) return { ...searchImage, lookupValue: keyword };
  }

  if (knownUrl) {
    return {
      imageUrl: knownUrl,
      productUrl: VOLSHOP_BASE_URL,
      lookupValue: lookupValue || clean(item.artCode),
    };
  }

  if (lookupValue) {
    for (const directUrl of volshopProductImageUrls(lookupValue)) {
      if (await imageExists(directUrl)) {
        return { imageUrl: directUrl, productUrl: VOLSHOP_BASE_URL, lookupValue };
      }
    }
  }

  return null;
}

function storageAdminClient(supabaseUrl: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function ensureProductImageBucket(client: SupabaseClient) {
  const { data, error } = await client.storage.listBuckets();
  if (error) return false;

  const bucket = data?.find((item) => item.name === PRODUCT_IMAGE_BUCKET || item.id === PRODUCT_IMAGE_BUCKET);
  if (!bucket) {
    const { error: createError } = await client.storage.createBucket(PRODUCT_IMAGE_BUCKET, { public: true });
    return !createError;
  }

  if (!bucket.public) {
    const { error: updateError } = await client.storage.updateBucket(PRODUCT_IMAGE_BUCKET, { public: true });
    return !updateError;
  }

  return true;
}

async function cacheProductImage(client: SupabaseClient, match: ProductImageMatch, accountName: string) {
  const imageBytes = await fetchImageBytes(match.sourceImageUrl || match.imageUrl);
  if (!imageBytes) return null;

  const optimized = await optimizeImage(imageBytes);
  if (!optimized) return null;

  const storagePath = productImageStoragePath(accountName, match);
  const { error } = await client.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(storagePath, optimized.bytes, {
      cacheControl: "31536000",
      contentType: optimized.contentType,
      upsert: true,
    });

  if (error) return null;

  const publicUrl = client.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  return { publicUrl, storagePath };
}

async function fetchImageBytes(imageUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "SalesLens/1.0 (product image caching)",
      },
      signal: controller.signal,
    });

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!response.ok || !contentType.includes("image")) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > PRODUCT_IMAGE_CACHE_MAX_BYTES) return null;
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

async function optimizeImage(bytes: Buffer) {
  try {
    const sharp = (await import("sharp")).default;
    return {
      bytes: await sharp(bytes, { failOn: "none" })
        .rotate()
        .resize({
          width: PRODUCT_IMAGE_CACHE_WIDTH,
          height: PRODUCT_IMAGE_CACHE_WIDTH,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: PRODUCT_IMAGE_CACHE_QUALITY })
        .toBuffer(),
      contentType: "image/webp",
    };
  } catch {
    return null;
  }
}

function productImageStoragePath(accountName: string, match: ProductImageMatch) {
  const account = slugPart(accountName || "saleslens");
  const style = slugPart(match.style);
  const art = slugPart(match.artCode);
  const color = slugPart(match.color);
  const sourceHash = createHash("sha1").update(match.sourceImageUrl || match.imageUrl).digest("hex").slice(0, 8);
  return `${account}/${style}/${art}/${color}-${sourceHash}.webp`;
}

function slugPart(value: string) {
  return normalized(value).toLowerCase() || "unknown";
}

async function volshopImageFromSearchKeyword(keyword: string) {
  const searchUrl = `${VOLSHOP_BASE_URL}/search?keywords=${encodeURIComponent(keyword)}`;
  const html = await fetchText(searchUrl).catch(() => "");
  if (!html) return null;

  const imageUrl = volshopImageFromDetail(html, searchUrl);
  if (!imageUrl || imageUrl.toLowerCase().includes("no_image_available")) return null;

  return { imageUrl, productUrl: searchUrl };
}

function volshopProductImageUrls(parentSku: string) {
  const encodedSku = encodeURIComponent(parentSku);
  return ["jpg", "png", "jpeg"].map(
    (extension) => `${VOLSHOP_BASE_URL}/site/product-images/${encodedSku}_01.${extension}?resizeid=3&resizeh=1200&resizew=1200`,
  );
}

async function volshopProductDetailUrlsForKeyword(keyword: string) {
  const searchUrls = [
    `${VOLSHOP_BASE_URL}/search?keywords=${encodeURIComponent(keyword)}`,
    `${VOLSHOP_BASE_URL}/search?keyword=${encodeURIComponent(keyword)}`,
  ];
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const searchUrl of searchUrls) {
    const html = await fetchText(searchUrl).catch(() => "");
    const pattern = /href\s*=\s*["']((?:https?:\/\/www\.utvolshop\.com)?\/[^"']+?)(?:["?#]|&quot;)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const value = absoluteUrl(decodeHtml(match[1]), VOLSHOP_BASE_URL);
      if (!value || seen.has(value) || !looksLikeVolshopProductUrl(value)) continue;
      seen.add(value);
      urls.push(value);
    }
  }

  return urls;
}

function volshopDetailMatches(html: string, item: ImageRequestItem, keyword: string) {
  const compactHtml = normalized(html);
  const productSku = normalized(keyword);
  if (productSku && compactHtml.includes(productSku)) return true;

  const parentSku = normalized(item.parentSku);
  const sku = normalized(item.sku);
  if (parentSku && compactHtml.includes(parentSku)) return true;
  if (sku && compactHtml.includes(sku)) return true;

  const title = normalized(productTitle(html));
  const description = normalized(item.styleName);
  return Boolean(description && title && sharedMeaningfulWords(description, title) >= 2);
}

function volshopImageFromDetail(html: string, productUrl: string) {
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (ogImage) return decodeHtml(absoluteUrl(ogImage, productUrl));

  const image = html.match(/https?:\/\/www\.utvolshop\.com\/site\/product-images\/[^"']+\.(?:jpg|jpeg|png)(?:\?[^"']*)?/i)?.[0];
  return image ? decodeHtml(image) : null;
}

async function imageExists(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": "SalesLens/1.0 (product image matching)",
      },
      signal: controller.signal,
    });
    return response.ok && (response.headers.get("content-type") ?? "").toLowerCase().includes("image");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeVolshopProductUrl(value: string) {
  const url = new URL(value);
  return url.hostname === "www.utvolshop.com" && /_[0-9]+\/?$/.test(url.pathname);
}

function volshopSku(value: string | null | undefined) {
  const cleaned = clean(value).replace(/\s+/g, "");
  return /^[A-Za-z0-9_-]+$/.test(cleaned) ? cleaned : "";
}

function isVolshopAccount(accountName: string) {
  const normalizedName = accountName.toLowerCase();
  return normalizedName.includes("volshop") || normalizedName.includes("vol shop");
}

async function productDetailUrlsForItem(item: ImageRequestItem, lookupArtCode: string) {
  const urls = [
    ...await productDetailUrlsForKeyword(lookupArtCode),
    ...await productDetailUrlsForDecoratedArtCode(lookupArtCode),
    ...await productDetailUrlsForKeyword(clean(item.styleName)),
    ...await productDetailUrlsForKeyword([clean(item.style), clean(item.color)].filter(Boolean).join(" ")),
    ...await productDetailUrlsForKeyword(clean(item.style)),
  ];
  const seen = new Set<string>();
  return urls.filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

async function productDetailUrlsForDecoratedArtCode(lookupArtCode: string) {
  const artCode = clean(lookupArtCode);
  if (!/^\d{6,}$/.test(artCode)) return [];

  const results = await Promise.all(
    ["APC", "AEC", "AP"].map((prefix) => productDetailUrlsForKeyword(`${prefix}${artCode}`)),
  );
  return results.flat();
}

async function productDetailUrlsForKeyword(keyword: string) {
  const cleanKeyword = clean(keyword);
  if (!cleanKeyword) return [];

  const searchUrl = `${REBEL_RAGS_BASE_URL}/all-products/browse/keyword/${encodeURIComponent(cleanKeyword)}`;
  const html = await fetchText(searchUrl);
  const pattern = /href\s*=\s*["']((?:https?:\/\/www\.rebelrags\.net)?\/[^"']+-[0-9]+\/?(?:\?[^"']*)?)["']/gi;
  const urls: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const value = absoluteUrl(decodeHtml(match[1]));
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
  }

  return urls;
}

function imageLookup(item: ImageRequestItem): ProductImageLookup {
  const style = normalized(item.style);
  const artCode = normalized(item.artCode);
  const color = normalized(item.color);
  const description = normalized(item.styleName);
  const isWhiteScriptBasicTee = style === "CT1000"
    && color === "WHITE"
    && description.includes("SCRIPTOLEMISSBASICSHORTSLEEVETEE");
  const isWhiteScriptArtOverride = color === "WHITE"
    && ["CT1000", "CS1220", "CS2071", "CT1730"].includes(style)
    && ["03456518", "0346518", "APC03479022", "03479022"].includes(artCode);

  if (isWhiteScriptBasicTee || isWhiteScriptArtOverride) {
    return { searchArtCode: "03479022", isManualOverride: true, productUrl: null };
  }

  const namedrop = namedropCt1000Lookup(item);
  if (namedrop) return namedrop;

  if (style === "CT1000" && artCode === "03456518") {
    return {
      searchArtCode: clean(item.artCode),
      isManualOverride: true,
      productUrl: `${REBEL_RAGS_BASE_URL}/champion/script-ole-miss-basic-short-sleeve-tee-2744`,
    };
  }

  if (style === "CT1000" && artCode === "03503350") {
    return {
      searchArtCode: clean(item.artCode),
      isManualOverride: true,
      productUrl: `${REBEL_RAGS_BASE_URL}/champion/script-ole-miss-softball-basic-tee-22276`,
    };
  }

  if (style === "GDH100" && artCode === "004116649") {
    return {
      searchArtCode: clean(item.artCode),
      isManualOverride: true,
      productUrl: `${REBEL_RAGS_BASE_URL}/gear/block-rebs-comfort-wash-ss-tee-31521`,
    };
  }

  if (style === "GDH135" && artCode === "004116649") {
    return {
      searchArtCode: clean(item.artCode),
      isManualOverride: true,
      productUrl: `${REBEL_RAGS_BASE_URL}/gear/block-rebs-comfort-wash-ss-boxy-tee-31522`,
    };
  }

  if (style === "CBRZU0Z") {
    return {
      searchArtCode: clean(item.artCode) || style,
      isManualOverride: true,
      productUrl: `${REBEL_RAGS_BASE_URL}/champion/ole-miss-infant-3-pack-bodysuit-set-24997`,
    };
  }

  return { searchArtCode: clean(item.artCode), isManualOverride: false, productUrl: null };
}

function namedropCt1000Lookup(item: ImageRequestItem): ProductImageLookup | null {
  if (normalized(item.style) !== "CT1000") return null;

  const lookup = REBEL_RAGS_NAMEDROP_CT1000_LOOKUPS[normalizedArtNumber(item.artCode)];
  if (!lookup) return null;

  return {
    searchArtCode: lookup.productCode,
    isManualOverride: true,
    productUrl: lookup.productUrl,
  };
}

function detailMatches(html: string, item: ImageRequestItem, lookupArtCode: string, productUrl: string) {
  const compactHtml = normalized(html);
  const compactUrl = normalized(productUrl);
  const style = normalized(item.style);
  const artCode = normalized(lookupArtCode);
  const title = normalized(productTitle(html));
  const description = normalized(item.styleName);

  if (compactHtml.includes(style + artCode)
    || compactHtml.includes(artCode + style)
    || compactUrl.includes(artCode)
    || title.includes(artCode)) {
    return true;
  }

  if (compactHtml.includes(style) && compactHtml.includes(artCode)) return true;

  return Boolean(description && title && sharedMeaningfulWords(description, title) >= 2);
}

function productImageUrl(html: string, item: ImageRequestItem, productUrl: string) {
  const knownUrl = knownProductImageUrl(item);
  if (knownUrl) return knownUrl;

  const pattern = /(https?:\/\/www\.rebelrags\.net\/prodimages\/[^"']+-(?:l|m|s)\.(?:jpg|jpeg|png)|\/prodimages\/[^"']+-(?:l|m|s)\.(?:jpg|jpeg|png))/gi;
  const urls = captures(pattern, html)
    .map((value) => absoluteUrl(decodeHtml(value), productUrl))
    .map(preferLargeImageUrl)
    .filter(Boolean);
  const colorMatch = urls.find((url) => imageUrlMatchesColor(url, clean(item.color)));
  if (colorMatch) return colorMatch;

  return urls.find((url) => canUseDefaultImageUrl(url, item)) ?? null;
}

function canUseDefaultImageUrl(value: string, item: ImageRequestItem) {
  if (imageColorToken(value) !== "DEFAULT") return false;
  return allowsDefaultImage(item);
}

function imageUrlMatchesColor(value: string, colorName: string) {
  const filename = normalized(imageFilename(value));
  return colorSearchTerms(colorName).some((term) => filename.includes(term));
}

function colorSearchTerms(colorName: string) {
  const color = normalized(colorName);
  const terms = [color];
  if (color === "LIGHTBLUE") terms.push("LTBLUE");
  if (color === "GRAYCAROLINABLUE") terms.push("LIGHTBLUE", "LTBLUE", "CAROLINABLUE");
  if (color === "GREY") terms.push("GRAY");
  if (color === "GRAY") terms.push("GREY");
  if (color === "HEATHERGREY") terms.push("HEATHERGRAY");
  if (color === "HEATHERGRAY") terms.push("HEATHERGREY");
  if (color === "OXFORDGREY") terms.push("OXFORDGRAY");
  if (color === "OXFORDGRAY") terms.push("OXFORDGREY");
  if (color === "SILVERGREY") terms.push("SILVERGRAY");
  if (color === "SILVERGRAY") terms.push("SILVERGREY");
  if (color === "NAVY") terms.push("MIDNIGHTNAVY");
  if (color === "MIDNIGHTNAVY") terms.push("NAVY");
  if (color === "SCARLET") terms.push("RED");
  if (color === "RED") terms.push("SCARLET");
  return terms;
}

function allowsDefaultImage(item: ImageRequestItem) {
  return normalized(item.color) === "WHITE"
    || normalized(item.style) === "CBRZU0Z"
    || isGearStyle(item.style)
    || isMappedNamedropCt1000(item)
    || isKnownDefaultImageMatch(item);
}

function isMappedNamedropCt1000(item: ImageRequestItem) {
  return normalized(item.style) === "CT1000"
    && Boolean(REBEL_RAGS_NAMEDROP_CT1000_LOOKUPS[normalizedArtNumber(item.artCode)]);
}

function isGearStyle(style: string | null | undefined) {
  const normalizedStyle = normalized(style);
  return GEAR_STYLE_PREFIXES.some((prefix) => normalizedStyle.startsWith(prefix));
}

function preferLargeImageUrl(value: string) {
  return value.replace(/-(?:s|m)\.(jpg|jpeg|png)(\?.*)?$/i, "-l.$1$2");
}

function knownProductImageUrl(item: ImageRequestItem) {
  return knownVolshopProductImageUrl(item) ?? knownRebelRagsProductImageUrl(item);
}

function knownVolshopProductImageUrl(item: ImageRequestItem) {
  const style = normalized(item.style);
  const artCode = normalized(item.artCode);
  const color = normalized(item.color);

  return knownVolshopImages[imageKey(style, artCode, color)] ?? null;
}

function knownRebelRagsProductImageUrl(item: ImageRequestItem) {
  const style = normalized(item.style);
  const artCode = normalized(item.artCode);
  const color = normalized(item.color);

  return knownRebelRagsImages[imageKey(style, artCode, color)] ?? null;
}

const knownVolshopImages: Record<string, string> = {
  [imageKey("CS3050", "AEC03612724", "GREY")]: `${VOLSHOP_BASE_URL}/site/product-images/368238p_02.jpg?resizeid=3&resizeh=1200&resizew=1200`,
};

const knownRebelRagsImages: Record<string, string> = {
  [imageKey("CT1000", "03456518", "NAVY")]: `${REBEL_RAGS_BASE_URL}/prodimages/16228-MIDNIGHT_NAVY-l.jpg`,
  [imageKey("CT1000", "03503350", "LIGHTBLUE")]: `${REBEL_RAGS_BASE_URL}/prodimages/23149-DEFAULT-l.jpg`,
  [imageKey("CT1000", "03687236", "WHITE")]: `${REBEL_RAGS_BASE_URL}/prodimages/25026-WHITE-l.jpg`,
  [imageKey("CT1000", "03751915", "WHITE")]: `${REBEL_RAGS_BASE_URL}/prodimages/26212-DEFAULT-l.jpg`,
  [imageKey("CT1000", "03751916", "WHITE")]: `${REBEL_RAGS_BASE_URL}/prodimages/26213-DEFAULT-l.jpg`,
  [imageKey("GDH100", "003862801", "PORCHBLUE")]: `${REBEL_RAGS_BASE_URL}/prodimages/27361-PORCH_BLUE-l.jpg`,
  [imageKey("GDH100", "003862801", "COTTONCANDY")]: `${REBEL_RAGS_BASE_URL}/prodimages/27361-COTTON_CANDY-l.jpg`,
  [imageKey("GDH100", "004116676", "COTTONCANDY")]: `${REBEL_RAGS_BASE_URL}/prodimages/30756-COTTON_CANDY-l.jpg`,
};

function isKnownDefaultImageMatch(item: ImageRequestItem) {
  return normalized(item.style) === "CT1000"
    && normalized(item.artCode) === "03503350"
    && normalized(item.color) === "LIGHTBLUE";
}

function imageKey(style: string, artCode: string, color: string) {
  return [normalized(style), normalized(artCode), normalized(color)].join("|");
}

function namedropLookup(productCode: string, productPath: string) {
  return {
    productCode,
    productUrl: absoluteUrl(productPath),
  };
}

function normalizedArtNumber(value: string | null | undefined) {
  return normalized(value).replace(/^(?:APC|AEC|APO|AP)/, "");
}

function imageColorToken(value: string) {
  const parts = imageFilename(value).split("-");
  if (parts.length < 2) return "";
  return normalized(parts[parts.length - 2]);
}

function imageFilename(value: string) {
  const pathname = absoluteUrl(decodeHtml(value)).split("?")[0] ?? "";
  const filename = pathname.split("/").pop() ?? "";
  return filename.replace(/\.[a-z0-9]+$/i, "");
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "SalesLens/1.0 (product image matching)",
      },
      signal: controller.signal,
    });

    if (!response.ok) return "";
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function captures(pattern: RegExp, text: string) {
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) values.push(match[1]);
  return values;
}

function productTitle(html: string) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (ogTitle) return decodeHtml(ogTitle);
  return decodeHtml(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "");
}

function sharedMeaningfulWords(left: string, right: string) {
  const stopWords = new Set(["THE", "AND", "FOR", "WITH", "TEE", "SHIRT", "S", "SS", "LS", "LONG", "SHORT", "SLEEVE"]);
  const leftWords = words(left).filter((word) => !stopWords.has(word));
  const rightWords = new Set(words(right).filter((word) => !stopWords.has(word)));
  return leftWords.filter((word) => rightWords.has(word)).length;
}

function words(value: string) {
  return normalized(value).match(/[A-Z0-9]{3,}/g) ?? [];
}

function absoluteUrl(value: string, base = REBEL_RAGS_BASE_URL) {
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalized(value: string | null | undefined) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, "&");
}
