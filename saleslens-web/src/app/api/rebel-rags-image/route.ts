import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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
  lookupArtCode: string;
  isManualOverride: boolean;
};

const REBEL_RAGS_BASE_URL = "https://www.rebelrags.net";
const VOLSHOP_BASE_URL = "https://www.utvolshop.com";
const MAX_LOOKUPS = 30;

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

  for (const item of items) {
    const match = await matchingImage(item, accountName).catch(() => null);
    if (match) matches.push(match);
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
        lookupArtCode: volshopImage.lookupValue,
        isManualOverride: false,
      };
    }
    return null;
  }

  const lookup = imageLookup(item);
  const productUrls = lookup.productUrl ? [lookup.productUrl] : await productDetailUrlsForItem(item, lookup.searchArtCode);

  for (const productUrl of productUrls.slice(0, 50)) {
    const detailHtml = await fetchText(productUrl).catch(() => "");
    if (!detailHtml) continue;

    if (!lookup.productUrl && !detailMatches(detailHtml, item, lookup.searchArtCode, productUrl)) {
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
      lookupArtCode: lookup.searchArtCode,
      isManualOverride: lookup.isManualOverride,
    };
  }

  return null;
}

async function matchingVolshopImage(item: ImageRequestItem) {
  const knownUrl = knownVolshopProductImageUrl(item);
  if (knownUrl) {
    return {
      imageUrl: knownUrl,
      productUrl: VOLSHOP_BASE_URL,
      lookupValue: clean(item.parentSku) || clean(item.sku) || clean(item.artCode),
    };
  }

  const parentSku = volshopSku(item.parentSku);
  const sku = volshopSku(item.sku);
  const lookupValue = parentSku || sku;
  if (!lookupValue) return null;

  for (const directUrl of volshopProductImageUrls(lookupValue)) {
    if (await imageExists(directUrl)) {
      return { imageUrl: directUrl, productUrl: VOLSHOP_BASE_URL, lookupValue };
    }
  }

  for (const keyword of [parentSku, sku].filter(Boolean) as string[]) {
    const searchImage = await volshopImageFromSearchKeyword(keyword);
    if (searchImage) return { ...searchImage, lookupValue: keyword };
  }

  for (const keyword of [parentSku, sku, clean(item.style), clean(item.artCode)].filter(Boolean) as string[]) {
    const productUrls = await volshopProductDetailUrlsForKeyword(keyword);
    for (const productUrl of productUrls.slice(0, 12)) {
      const detailHtml = await fetchText(productUrl).catch(() => "");
      if (!detailHtml) continue;
      if (!volshopDetailMatches(detailHtml, item, keyword)) continue;
      const imageUrl = volshopImageFromDetail(detailHtml, productUrl);
      if (imageUrl) return { imageUrl, productUrl, lookupValue: keyword };
    }
  }

  return null;
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
  if (color === "HEATHERGREY") terms.push("HEATHERGRAY");
  if (color === "SILVERGREY") terms.push("SILVERGRAY");
  if (color === "NAVY") terms.push("MIDNIGHTNAVY");
  return terms;
}

function allowsDefaultImage(item: ImageRequestItem) {
  return normalized(item.color) === "WHITE"
    || normalized(item.style) === "CBRZU0Z"
    || isKnownDefaultImageMatch(item);
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
