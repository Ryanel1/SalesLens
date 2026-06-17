import * as XLSX from "xlsx";

export type ParsedSalesRecord = {
  transaction_date: string;
  received_date: string | null;
  amount: number;
  units: number | null;
  source_file: string;
  transaction_number: string | null;
  barcode: string | null;
  parent_sku: string | null;
  sku: string | null;
  product_class: string | null;
  master_style: string | null;
  color: string | null;
  size: string | null;
  raw_style_identifier: string | null;
  style_number: string | null;
  color_code: string | null;
  catalog_color_name: string | null;
  art_code: string | null;
  last_received: string | null;
  current_retail: number | null;
  year_to_date_amount: number | null;
  year_to_date_units: number | null;
  inventory_units: number | null;
};

export type ParsedInventoryRecord = {
  inventory_date: string;
  source_file: string;
  product_class: string | null;
  master_style: string | null;
  color: string | null;
  size: string | null;
  raw_style_identifier: string | null;
  style_number: string | null;
  catalog_color_name: string | null;
  art_code: string | null;
  inventory_units: number;
  current_retail: number | null;
};

export type ParsedUpload = {
  records: ParsedSalesRecord[];
  skippedCount: number;
  salesPeriodStart: string | null;
  salesPeriodEnd: string | null;
  receivedDate: string | null;
};

export type ParsedInventoryUpload = {
  records: ParsedInventoryRecord[];
  skippedCount: number;
  inventoryDate: string | null;
};

const COLOR_NAMES_BY_CODE: Record<string, string> = {
  "000": "White",
  "001": "Black",
  "035": "Oxford Grey",
  "940": "Heather Grey",
  "1616": "Light Blue",
};

const REBEL_RAGS_GEAR_STYLE_PREFIXES = ["GDH", "G", "C400", "C603", "CBR", "S650", "G209"];

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export async function parseSalesWorkbook(file: File, customerName: string): Promise<ParsedUpload> {
  const fileDate = Number.isFinite(file.lastModified) ? dateFromTimestamp(file.lastModified) : null;
  const workbook = XLSX.read(await file.arrayBuffer(), {
    cellDates: true,
    type: "array",
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("No worksheet found in this file.");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    blankrows: false,
    defval: "",
    header: 1,
    raw: false,
  });

  const headerIndex = rows.findIndex((row) => row.some((cell) => normalize(cell).length > 0));
  if (headerIndex === -1) throw new Error("No header row found in this file.");

  const usableRows = rows.slice(headerIndex);
  const firstRow = usableRows[0];
  if (!firstRow) throw new Error("No header row found in this file.");
  const header = firstRow.map(normalize);

  if (isRebelRagsHeader(header)) {
    return parseRebelRagsRows(usableRows, file.name);
  }

  return parseVolshopRows(usableRows, file.name, customerName, fileDate);
}

export async function parseInventoryWorkbook(file: File, customerName: string): Promise<ParsedInventoryUpload> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    cellDates: true,
    type: "array",
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("No worksheet found in this inventory file.");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    blankrows: false,
    defval: "",
    header: 1,
    raw: false,
  });

  const headerIndex = findInventoryHeaderIndex(rows);
  if (headerIndex === -1) throw new Error("No header row found in this inventory file.");

  const reportDate = reportDateFromRows(rows.slice(0, headerIndex + 1));
  const reportBrand = reportBrandFromRows(rows.slice(0, headerIndex + 1));
  const usableRows = rows.slice(headerIndex);
  const firstRow = usableRows[0];
  if (!firstRow) throw new Error("No header row found in this inventory file.");

  return parseInventoryRows(usableRows, file.name, customerName, reportDate, reportBrand);
}

function parseVolshopRows(rows: unknown[][], fileName: string, customerName: string, fileDate: string | null): ParsedUpload {
  const firstRow = rows[0];
  if (!firstRow) throw new Error("No header row found in this file.");
  const header = firstRow.map(normalize);
  const classIndex = findColumn(header, ["class"]);
  const masterStyleIndex = findColumn(header, ["masterstyle"]);
  const colorIndex = findColumn(header, ["color", "colour"]);
  const sizeIndex = findColumn(header, ["size"]);
  const styleColorIndex = findColumn(header, ["stylecolour", "stylecolor", "stylecolournumber", "stylecolornumber"]);
  const skuIndex = findColumn(header, ["name", "sku"]);
  const lastReceivedIndex = findColumn(header, ["lastrcvd", "lastreceived"]);
  const retailIndex = findColumn(header, ["currentretail"]);
  const mtdUnitsIndex = findColumn(header, ["mtdu"]);
  const mtdAmountIndex = findColumn(header, ["mtd"]);
  const ytdUnitsIndex = findColumn(header, ["ytdu"]);
  const ytdAmountIndex = findColumn(header, ["ytd"]);
  const inventoryUnitsIndex = findColumn(header, ["invu", "inventoryu", "inventoryunits"]);

  if (mtdAmountIndex == null || mtdUnitsIndex == null) {
    throw new Error("Missing required Volshop columns: MTD ($) and MTD (U).");
  }

  const receivedDateFromFileName = reportDateFromFileName(fileName);
  const receivedDate = receivedDateFromFileName ?? fileDate;
  const salesDate = salesPeriodDateFromFileName(fileName, receivedDateFromFileName) ?? monthStart(fileDate);
  const salesEndDate = salesPeriodEndDateFromFileName(fileName) ?? salesDate;
  if (!salesDate) {
    throw new Error("Could not determine the sales month from the file name or file date.");
  }

  let skippedCount = 0;
  const records: ParsedSalesRecord[] = [];

  for (const row of rows.slice(1)) {
    if (isTotalRow(valueAt(row, classIndex)) ||
      isTotalRow(valueAt(row, masterStyleIndex)) ||
      isTotalRow(valueAt(row, styleColorIndex))) {
      continue;
    }

    const amount = parseNumber(valueAt(row, mtdAmountIndex));
    if (amount == null) {
      skippedCount += 1;
      continue;
    }

    const rawStyleIdentifier = valueAt(row, styleColorIndex);
    const parsed = parseStyleIdentifier(rawStyleIdentifier);
    const parsedSku = parseVolshopSkuName(valueAt(row, skuIndex));

    records.push({
      transaction_date: salesDate,
      received_date: receivedDate,
      amount,
      units: parseInteger(valueAt(row, mtdUnitsIndex)),
      source_file: fileName,
      transaction_number: null,
      barcode: null,
      parent_sku: parsedSku.parentSku,
      sku: parsedSku.sku,
      product_class: clean(valueAt(row, classIndex)) ?? normalizedBrandClass(customerName),
      master_style: clean(valueAt(row, masterStyleIndex)),
      color: clean(valueAt(row, colorIndex)),
      size: clean(valueAt(row, sizeIndex)),
      raw_style_identifier: clean(rawStyleIdentifier),
      style_number: parsed.styleNumber,
      color_code: parsed.colorCode,
      catalog_color_name: parsed.colorCode ? COLOR_NAMES_BY_CODE[parsed.colorCode] ?? null : null,
      art_code: parsed.artCode,
      last_received: dateOnly(valueAt(row, lastReceivedIndex)),
      current_retail: parseNumber(valueAt(row, retailIndex)),
      year_to_date_amount: parseNumber(valueAt(row, ytdAmountIndex)),
      year_to_date_units: parseInteger(valueAt(row, ytdUnitsIndex)),
      inventory_units: parseInteger(valueAt(row, inventoryUnitsIndex)),
    });
  }

  return {
    records,
    skippedCount,
    salesPeriodStart: salesDate,
    salesPeriodEnd: salesEndDate,
    receivedDate,
  };
}

function parseRebelRagsRows(rows: unknown[][], fileName: string): ParsedUpload {
  const firstRow = rows[0];
  if (!firstRow) throw new Error("No header row found in this file.");
  const header = firstRow.map(normalize);
  const dateIndex = findColumn(header, ["date"]);
  const transactionNumberIndex = findColumn(header, ["num", "number", "transactionnumber", "transactionnum", "receipt", "receiptnum"]);
  const descriptionIndex = findColumn(header, ["descr", "description"]);
  const barcodeIndex = findColumn(header, ["barcode", "upc"]);
  const brandIndex = findColumn(header, ["brand"]);
  const productIndex = findColumn(header, ["product"]);
  const colorIndex = findColumn(header, ["color", "colour"]);
  const quantityIndex = findColumn(header, ["quantity", "qty"]);
  const totalPriceIndex = findColumn(header, ["totalprice", "sales", "amount"]);

  if (dateIndex == null || productIndex == null || quantityIndex == null || totalPriceIndex == null) {
    throw new Error("Missing required Rebel Rags columns: Date, Product, Quantity, and Total Price.");
  }

  let skippedCount = 0;
  const records: ParsedSalesRecord[] = [];

  for (const row of rows.slice(1)) {
    const transactionDate = dateOnly(valueAt(row, dateIndex));
    const rawProduct = valueAt(row, productIndex);
    const amount = parseNumber(valueAt(row, totalPriceIndex));
    const units = parseInteger(valueAt(row, quantityIndex));

    if (!transactionDate || !rawProduct || amount == null || units == null) {
      skippedCount += 1;
      continue;
    }

    const productIdentifier = parseRebelRagsProductIdentifier(rawProduct);
    const color = clean(valueAt(row, colorIndex));

    records.push({
      transaction_date: transactionDate,
      received_date: null,
      amount,
      units,
      source_file: fileName,
      transaction_number: clean(valueAt(row, transactionNumberIndex)),
      barcode: clean(valueAt(row, barcodeIndex)),
      parent_sku: null,
      sku: null,
      product_class: normalizedBrandClass(valueAt(row, brandIndex)),
      master_style: clean(valueAt(row, descriptionIndex)),
      color,
      size: null,
      raw_style_identifier: clean(rawProduct),
      style_number: productIdentifier.styleNumber,
      color_code: null,
      catalog_color_name: color,
      art_code: productIdentifier.artCode,
      last_received: transactionDate,
      current_retail: null,
      year_to_date_amount: null,
      year_to_date_units: null,
      inventory_units: null,
    });
  }

  const dates = records.map((record) => record.transaction_date).sort();
  return {
    records,
    skippedCount,
    salesPeriodStart: dates[0] ?? null,
    salesPeriodEnd: dates.at(-1) ?? null,
    receivedDate: null,
  };
}

function parseInventoryRows(
  rows: unknown[][],
  fileName: string,
  customerName: string,
  reportDate: string | null,
  reportBrand: string | null,
): ParsedInventoryUpload {
  const firstRow = rows[0];
  if (!firstRow) throw new Error("No header row found in this inventory file.");
  const header = firstRow.map(normalize);
  const dateIndex = findExactColumn(header, ["date", "inventorydate", "asofdate"]);
  const descriptionIndex = findColumn(header, ["descr", "description", "itemdescription", "productdescription"]);
  const brandIndex = findColumn(header, ["brand", "class", "productclass"]);
  const productIndex = findColumn(header, ["product", "sku", "item", "itemnumber", "style", "stylenumber"]);
  const artIndex = findColumn(header, ["art", "artcode", "artwork", "artworkcode", "design", "designcode"]);
  const colorIndex = findColumn(header, ["color", "colour"]);
  const sizeIndex = findColumn(header, ["size"]);
  const retailIndex = findColumn(header, ["retail", "currentretail", "price"]);
  const inventoryUnitsIndex = findColumn(header, [
    "onhand",
    "oh",
    "qtyonhand",
    "quantityonhand",
    "inventory",
    "inventoryunits",
    "invu",
    "qty",
    "quantity",
    "units",
  ]);

  if (productIndex == null || inventoryUnitsIndex == null) {
    throw new Error("Missing required inventory columns: Product/SKU and On Hand/Quantity.");
  }

  const fallbackDate = reportDate ?? reportDateFromFileName(fileName) ?? formatDate(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate(),
  );
  let skippedCount = 0;
  const records: ParsedInventoryRecord[] = [];

  for (const row of rows.slice(1)) {
    if (row.some((cell) => normalize(cell) === "total")) continue;

    const rawProduct = valueAt(row, productIndex);
    const inventoryUnits = parseInteger(valueAt(row, inventoryUnitsIndex));
    if (isTotalRow(rawProduct)) continue;
    if (!rawProduct || inventoryUnits == null) {
      skippedCount += 1;
      continue;
    }

    const productIdentifier = parseRebelRagsProductIdentifier(rawProduct);
    const color = clean(valueAt(row, colorIndex));
    const inventoryDate = dateOnly(valueAt(row, dateIndex)) ?? fallbackDate;
    const artCode = productIdentifier.artCode ?? normalizedInventoryArtCode(valueAt(row, artIndex));

    records.push({
      inventory_date: inventoryDate,
      source_file: fileName,
      product_class: normalizedInventoryBrandClass(valueAt(row, brandIndex) ?? reportBrand, productIdentifier.styleNumber, customerName),
      master_style: clean(valueAt(row, descriptionIndex)),
      color,
      size: clean(valueAt(row, sizeIndex)),
      raw_style_identifier: clean(rawProduct),
      style_number: productIdentifier.styleNumber,
      catalog_color_name: color,
      art_code: artCode,
      inventory_units: inventoryUnits,
      current_retail: parseNumber(valueAt(row, retailIndex)),
    });
  }

  const dates = records.map((record) => record.inventory_date).sort();
  return {
    records,
    skippedCount,
    inventoryDate: dates.at(-1) ?? null,
  };
}

function findInventoryHeaderIndex(rows: unknown[][]) {
  return rows.findIndex((row) => {
    const header = row.map(normalize);
    return hasExactHeader(header, ["product", "sku", "item", "itemnumber", "style", "stylenumber"]) &&
      hasExactHeader(header, ["onhand", "oh", "qtyonhand", "quantityonhand", "inventory", "inventoryunits", "invu", "qty", "quantity", "units"]);
  });
}

function hasExactHeader(header: string[], candidates: string[]) {
  return header.some((column) => candidates.includes(column));
}

function isRebelRagsHeader(header: string[]) {
  return Boolean(
    findColumn(header, ["date"]) != null &&
      findColumn(header, ["storereceiptnum", "receipt"]) != null &&
      findColumn(header, ["descr", "description"]) != null &&
      findColumn(header, ["product"]) != null &&
      findColumn(header, ["quantity", "qty"]) != null &&
      findColumn(header, ["totalprice", "sales", "amount"]) != null,
  );
}

function isTotalRow(value: string | null) {
  const normalized = normalize(value);
  return normalized === "total" || normalized === "overalltotal" || normalized === "grandtotal";
}

function parseStyleIdentifier(rawValue: string | null) {
  const cleaned = clean(rawValue)?.toUpperCase().replace(/\s+/g, "") ?? "";
  if (!cleaned) return { styleNumber: null, colorCode: null, artCode: null };

  const artMatch = cleaned.match(/(APC|APO|AEC|AE|AP)[A-Z0-9]+$/);
  const artCode = artMatch?.[0] ?? null;
  const prefix = artMatch ? cleaned.slice(0, artMatch.index ?? 0) : cleaned;
  const colorCode = splitColorCode(prefix);
  const styleNumber = colorCode ? prefix.slice(0, -colorCode.length).replace(/[-\s]+$/g, "") : prefix.replace(/[-\s]+$/g, "");

  return {
    styleNumber: styleNumber || null,
    colorCode,
    artCode,
  };
}

function parseVolshopSkuName(value: string | null) {
  const cleaned = clean(value);
  if (!cleaned) return { parentSku: null, sku: null };

  const [parent, child] = cleaned.split(":").map((part) => clean(part));
  return {
    parentSku: parent ?? null,
    sku: child ?? parent ?? null,
  };
}

function splitColorCode(prefix: string) {
  const known = Object.keys(COLOR_NAMES_BY_CODE)
    .sort((left, right) => right.length - left.length)
    .find((code) => prefix.endsWith(code));
  if (known) return known;
  const match = prefix.match(/(\d{3,4})$/);
  return match?.[1] ?? null;
}

function parseRebelRagsProductIdentifier(rawValue: string) {
  const tokens = rawValue
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const styleNumber = [...tokens].reverse().find(isRebelRagsStyleToken) ?? null;
  const artToken = tokens.find((token) => token !== styleNumber && isRebelRagsArtCodeToken(token)) ?? null;
  return {
    styleNumber,
    artCode: artToken ? normalizedRebelRagsArtCode(artToken) : null,
  };
}

function isRebelRagsStyleToken(token: string) {
  return /[A-Z]/.test(token) && /\d/.test(token) && token.length >= 4 && !isRebelRagsArtCodeToken(token);
}

function isRebelRagsArtCodeToken(token: string) {
  return /^(APC|APO|AEC|AE|AP)[A-Z0-9]+$/.test(token) || /^[A-Z]{1,3}[0-9]{6,}$/.test(token) || /^\d{6,}$/.test(token);
}

function normalizedRebelRagsArtCode(token: string) {
  if (/^[A-Z]{1,3}[0-9]{6,}$/.test(token)) {
    return token.replace(/^[A-Z]+/, "");
  }
  return token;
}

function normalizedInventoryArtCode(value: string | null) {
  const token = clean(value)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  if (!token) return null;
  return normalizedRebelRagsArtCode(token);
}

function normalizedInventoryBrandClass(value: string | null, styleNumber: string | null, customerName: string) {
  const explicit = normalizedBrandClass(value);
  if (explicit) return explicit;

  const style = styleNumber?.toUpperCase() ?? "";
  if (REBEL_RAGS_GEAR_STYLE_PREFIXES.some((prefix) => style.startsWith(prefix))) return "Gear";
  if (/rebel\s*rags/i.test(customerName)) return null;
  return normalizedBrandClass(customerName);
}

function reportDateFromRows(rows: unknown[][]) {
  for (const row of rows) {
    for (const cell of row) {
      const text = String(cell ?? "");
      const match = text.match(/Report Date:\s*([A-Za-z]+ \d{1,2}, \d{4})/i);
      const date = dateOnly(match?.[1] ?? null);
      if (date) return date;
    }
  }
  return null;
}

function reportBrandFromRows(rows: unknown[][]) {
  for (const row of rows) {
    for (const cell of row) {
      const text = String(cell ?? "");
      const match = text.match(/BRAND\s*=\s*''?([A-Z0-9 &-]+)''?/i);
      const brand = normalizedBrandClass(match?.[1] ?? null);
      if (brand) return brand;
    }
  }
  return null;
}

function reportDateFromFileName(fileName: string) {
  const parsed = monthDateFromText(fileName);
  if (parsed?.isRange) return null;
  return parsed ? formatDate(parsed.year, parsed.month, parsed.day ?? 1) : null;
}

function salesPeriodDateFromFileName(fileName: string, receivedDate: string | null) {
  const parsed = monthDateFromText(fileName);
  if (parsed) {
    const date = new Date(Date.UTC(parsed.year, parsed.month, parsed.day ?? 1));
    if (!parsed.isRange && (parsed.day ?? 1) === 1) {
      date.setUTCMonth(date.getUTCMonth() - 1);
    }
    return formatDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }

  if (!receivedDate) return null;
  const date = new Date(`${receivedDate}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return formatDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function salesPeriodEndDateFromFileName(fileName: string) {
  const parsed = monthDateFromText(fileName);
  if (!parsed?.isRange || !parsed.endDay) return null;
  return formatDate(parsed.year, parsed.month, parsed.endDay);
}

function monthDateFromText(value: string) {
  const lower = value.toLowerCase();
  for (const [name, month] of Object.entries(MONTHS)) {
    const rangeMatch = lower.match(new RegExp(`\\b${name}\\b\\D*(\\d{1,2})\\s*(?:-|–|—|to|through|thru)\\s*(\\d{1,2})\\D*(\\d{2,4})`));
    if (rangeMatch) {
      const year = normalizeYear(rangeMatch[3]);
      if (!year) continue;
      return {
        month,
        day: Number(rangeMatch[1]),
        endDay: Number(rangeMatch[2]),
        year,
        isRange: true,
      };
    }

    const match = lower.match(new RegExp(`\\b${name}\\b\\D*(\\d{1,2})?\\D*(\\d{2,4})`));
    if (!match) continue;
    const year = normalizeYear(match[2]);
    if (!year) continue;
    return {
      month,
      day: match[1] ? Number(match[1]) : null,
      year,
      isRange: false,
    };
  }
  return null;
}

function normalizeYear(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed < 100 ? parsed + 2000 : parsed;
}

function dateOnly(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDate(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const year = normalizeYear(match[3]);
  if (!year) return null;
  return formatDate(year, Number(match[1]) - 1, Number(match[2]));
}

function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateFromTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function monthStart(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date.getFullYear(), date.getMonth(), 1);
}

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumn(header: string[], candidates: string[]) {
  const exact = header.findIndex((column) => candidates.includes(column));
  if (exact !== -1) return exact;
  const partial = header.findIndex((column) => candidates.some((candidate) => column.includes(candidate)));
  return partial === -1 ? null : partial;
}

function findExactColumn(header: string[], candidates: string[]) {
  const exact = header.findIndex((column) => candidates.includes(column));
  return exact === -1 ? null : exact;
}

function valueAt(row: unknown[], index: number | null) {
  if (index == null) return null;
  const value = row[index];
  return clean(String(value ?? ""));
}

function clean(value: string | null | undefined) {
  const cleaned = value?.replace(/\u00a0/g, " ").trim() ?? "";
  return cleaned.length ? cleaned : null;
}

function parseInteger(value: string | null) {
  const number = parseNumber(value);
  return number == null ? null : Math.round(number);
}

function parseNumber(value: string | null) {
  if (!value) return null;
  const cleaned = value.replace(/\$/g, "").replace(/,/g, "").replace(/\(/g, "-").replace(/\)/g, "").trim();
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function normalizedBrandClass(value: string | null) {
  const cleaned = clean(value);
  if (!cleaned) return null;
  if (/gear|comfort\s*wash/i.test(cleaned)) return "Gear";
  return "Champion";
}
