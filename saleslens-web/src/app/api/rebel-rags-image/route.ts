import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";

type ImageRequestItem = {
  style?: string;
  artCode?: string;
  color?: string;
  styleName?: string;
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
  const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_LOOKUPS) as ImageRequestItem[] : [];
  const matches: ProductImageMatch[] = [];

  for (const item of items) {
    const match = await matchingImage(item).catch(() => null);
    if (match) matches.push(match);
  }

  return NextResponse.json({ matches });
}

async function matchingImage(item: ImageRequestItem): Promise<ProductImageMatch | null> {
  const style = clean(item.style);
  const artCode = clean(item.artCode);
  const color = clean(item.color);

  if (!style || !artCode || !color) return null;

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

async function productDetailUrlsForItem(item: ImageRequestItem, lookupArtCode: string) {
  const urls = [
    ...await productDetailUrlsForKeyword(lookupArtCode),
    ...await productDetailUrlsForKeyword(clean(item.style)),
  ];
  const seen = new Set<string>();
  return urls.filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
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

  if (isWhiteScriptBasicTee || (style === "CT1000" && color === "WHITE" && ["03456518", "0346518"].includes(artCode))) {
    return { searchArtCode: "03479022", isManualOverride: true, productUrl: null };
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
  const pattern = /(https?:\/\/www\.rebelrags\.net\/prodimages\/[^"']+-l\.(?:jpg|jpeg|png)|\/prodimages\/[^"']+-l\.(?:jpg|jpeg|png))/gi;
  const urls = captures(pattern, html)
    .map((value) => absoluteUrl(decodeHtml(value), productUrl))
    .filter(Boolean);
  const colorMatch = urls.find((url) => imageUrlMatchesColor(url, clean(item.color)));
  if (colorMatch) return colorMatch;

  return urls.find((url) => canUseDefaultImageUrl(url, item, urls)) ?? null;
}

function canUseDefaultImageUrl(value: string, item: ImageRequestItem, allImageUrls: string[]) {
  if (imageColorToken(value) !== "DEFAULT") return false;
  return allowsDefaultImage(item) || imageUrlsOnlyHaveDefaultColor(allImageUrls);
}

function imageUrlsOnlyHaveDefaultColor(imageUrls: string[]) {
  const tokens = new Set(imageUrls.map(imageColorToken).filter(Boolean));
  return tokens.size > 0 && [...tokens].every((token) => token === "DEFAULT");
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
  return terms;
}

function allowsDefaultImage(item: ImageRequestItem) {
  return normalized(item.color) === "WHITE";
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
