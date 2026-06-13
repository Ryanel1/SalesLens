import Foundation

enum CSVImportError: LocalizedError {
    case unreadableFile
    case missingRequiredColumns([String])
    case missingSalesMonth(String)

    var errorDescription: String? {
        switch self {
        case .unreadableFile:
            return "The selected CSV file could not be read."
        case .missingRequiredColumns(let missing):
            return "The CSV is missing required columns: \(missing.joined(separator: ", "))."
        case .missingSalesMonth(let fileName):
            return "Could not determine the sales month from \(fileName). Rename it with a month and year, like April2026 Data.xlsx or May 1 26.xls."
        }
    }
}

struct POSImportResult {
    let records: [SalesRecord]
    let skippedCount: Int
}

enum POSCSVImporter {
    static func parse(url: URL) throws -> POSImportResult {
        let didStartAccessing = url.startAccessingSecurityScopedResource()
        defer {
            if didStartAccessing {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let fileName = url.lastPathComponent
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            if url.pathExtension.lowercased() == "xlsx" {
                return try parseXLSX(url: url, fileName: fileName)
            }
            throw CSVImportError.unreadableFile
        }

        if text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("<?xml"),
           text.contains("schemas-microsoft-com:office:spreadsheet") {
            return try parseSpreadsheetXML(text: text, fileName: fileName)
        }

        return try parseCSV(text: text, fileName: fileName)
    }

    private static func parseXLSX(url: URL, fileName: String) throws -> POSImportResult {
        let workbook = try XLSXWorkbookReader.read(url: url)
        guard let sheet = workbook.sheets.first else {
            throw CSVImportError.unreadableFile
        }

        return try parseProductRows(
            rows: sheet.rows,
            sheetName: sheet.name,
            fileName: fileName
        )
    }

    private static func parseCSV(text: String, fileName: String) throws -> POSImportResult {
        let rows = parseRows(from: text)
        guard let header = rows.first else {
            throw CSVImportError.unreadableFile
        }

        let normalizedHeader = header.map(normalize)
        let customerIndex = findColumn(in: normalizedHeader, candidates: ["customer", "customername", "account", "accountname", "retailer", "store", "location"])
        let dateIndex = findColumn(in: normalizedHeader, candidates: ["date", "salesdate", "transactiondate", "month", "period", "businessdate"])
        let amountIndex = findColumn(in: normalizedHeader, candidates: ["sales", "netsales", "grosssales", "revenue", "amount", "total", "salestotal"])
        let unitsIndex = findColumn(in: normalizedHeader, candidates: ["units", "quantity", "qty", "itemssold", "unitssold"])

        var missing: [String] = []
        if customerIndex == nil { missing.append("customer") }
        if dateIndex == nil { missing.append("date") }
        if amountIndex == nil { missing.append("sales amount") }
        if !missing.isEmpty { throw CSVImportError.missingRequiredColumns(missing) }

        var records: [SalesRecord] = []
        var skippedCount = 0

        for row in rows.dropFirst() {
            guard
                let customerIndex,
                let dateIndex,
                let amountIndex,
                row.indices.contains(customerIndex),
                row.indices.contains(dateIndex),
                row.indices.contains(amountIndex)
            else {
                skippedCount += 1
                continue
            }

            let customerName = row[customerIndex].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !customerName.isEmpty,
                  let date = parseDate(row[dateIndex]),
                  let amount = parseDecimal(row[amountIndex]) else {
                skippedCount += 1
                continue
            }

            let units = unitsIndex.flatMap { index -> Int? in
                guard row.indices.contains(index) else { return nil }
                return Int(row[index].replacingOccurrences(of: ",", with: ""))
            }

            records.append(
                SalesRecord(
                    customerName: customerName,
                    date: date,
                    amount: amount,
                    units: units,
                    sourceFile: fileName
                )
            )
        }

        return POSImportResult(records: records, skippedCount: skippedCount)
    }

    private static func parseSpreadsheetXML(text: String, fileName: String) throws -> POSImportResult {
        let parser = SpreadsheetXMLParser()
        let xmlParser = XMLParser(data: Data(text.utf8))
        xmlParser.delegate = parser

        guard xmlParser.parse(), let sheet = parser.sheets.first else {
            throw CSVImportError.unreadableFile
        }

        return try parseProductRows(rows: sheet.rows, sheetName: sheet.name, fileName: fileName)
    }

    private static func parseProductRows(rows: [[String]], sheetName: String, fileName: String) throws -> POSImportResult {
        guard let header = rows.first else {
            throw CSVImportError.unreadableFile
        }

        let normalizedHeader = header.map(normalize)
        if isRebelRagsTransactionHeader(normalizedHeader) {
            return try parseRebelRagsTransactionRows(rows: rows, sheetName: sheetName, fileName: fileName)
        }

        let classIndex = findColumn(in: normalizedHeader, candidates: ["class"])
        let masterStyleIndex = findColumn(in: normalizedHeader, candidates: ["masterstyle"])
        let colorIndex = findColumn(in: normalizedHeader, candidates: ["color", "colour"])
        let sizeIndex = findColumn(in: normalizedHeader, candidates: ["size"])
        let styleColorIndex = findColumn(in: normalizedHeader, candidates: ["stylecolour", "stylecolor", "stylecolournumber", "stylecolornumber"])
        let lastReceivedIndex = findColumn(in: normalizedHeader, candidates: ["lastrcvd", "lastreceived"])
        let retailIndex = findColumn(in: normalizedHeader, candidates: ["currentretail"])
        let mtdUnitsIndex = findColumn(in: normalizedHeader, candidates: ["mtdu"])
        let mtdAmountIndex = findColumn(in: normalizedHeader, candidates: ["mtd"])
        let ytdUnitsIndex = findColumn(in: normalizedHeader, candidates: ["ytdu"])
        let ytdAmountIndex = findColumn(in: normalizedHeader, candidates: ["ytd"])
        let inventoryUnitsIndex = findColumn(in: normalizedHeader, candidates: ["invu", "inventoryu", "inventoryunits"])
        let inventoryValueIndex = findColumn(in: normalizedHeader, candidates: ["invretail", "invretailvalue", "inventoryretailvalue"])

        var missing: [String] = []
        if mtdAmountIndex == nil { missing.append("MTD ($)") }
        if mtdUnitsIndex == nil { missing.append("MTD (U)") }
        if !missing.isEmpty { throw CSVImportError.missingRequiredColumns(missing) }

        let customerName = customerName(from: sheetName)
        let receivedDate = reportDate(from: fileName)
        guard let salesDate = salesPeriodDate(fromFileName: fileName, receivedDate: receivedDate) else {
            throw CSVImportError.missingSalesMonth(fileName)
        }
        var records: [SalesRecord] = []
        var skippedCount = 0

        for row in rows.dropFirst() {
            if row.contains(where: { normalize($0) == "total" }) {
                continue
            }

            guard let mtdAmountIndex,
                  let mtdUnitsIndex,
                  let amount = value(at: mtdAmountIndex, in: row).flatMap(parseDecimal) else {
                skippedCount += 1
                continue
            }

            let rawStyleIdentifier = value(at: styleColorIndex, in: row)
            let parsedIdentifier = rawStyleIdentifier.map(StyleIdentifierParser.parse)

            records.append(
                SalesRecord(
                    customerName: customerName,
                    date: salesDate,
                    receivedDate: receivedDate,
                    amount: amount,
                    units: value(at: mtdUnitsIndex, in: row).flatMap(parseInteger),
                    sourceFile: fileName,
                    productClass: value(at: classIndex, in: row),
                    masterStyle: value(at: masterStyleIndex, in: row),
                    color: value(at: colorIndex, in: row),
                    size: value(at: sizeIndex, in: row),
                    rawStyleIdentifier: rawStyleIdentifier,
                    styleNumber: parsedIdentifier?.styleNumber,
                    colorCode: parsedIdentifier?.colorCode,
                    catalogColorName: parsedIdentifier?.colorCode.flatMap { ProductCatalog.colorNamesByCode[$0] },
                    artCode: parsedIdentifier?.artCode,
                    lastReceived: value(at: lastReceivedIndex, in: row).flatMap(parseDate),
                    currentRetail: value(at: retailIndex, in: row).flatMap(parseDecimal),
                    yearToDateAmount: value(at: ytdAmountIndex, in: row).flatMap(parseDecimal),
                    yearToDateUnits: value(at: ytdUnitsIndex, in: row).flatMap(parseInteger),
                    inventoryUnits: value(at: inventoryUnitsIndex, in: row).flatMap(parseInteger),
                    inventoryRetailValue: value(at: inventoryValueIndex, in: row).flatMap(parseDecimal)
                )
            )
        }

        return POSImportResult(records: records, skippedCount: skippedCount)
    }

    private static func isRebelRagsTransactionHeader(_ normalizedHeader: [String]) -> Bool {
        findColumn(in: normalizedHeader, candidates: ["date"]) != nil
            && findColumn(in: normalizedHeader, candidates: ["storereceiptnum", "receipt"]) != nil
            && findColumn(in: normalizedHeader, candidates: ["descr", "description"]) != nil
            && findColumn(in: normalizedHeader, candidates: ["product"]) != nil
            && findColumn(in: normalizedHeader, candidates: ["quantity", "qty"]) != nil
            && findColumn(in: normalizedHeader, candidates: ["totalprice", "sales", "amount"]) != nil
    }

    private static func parseRebelRagsTransactionRows(rows: [[String]], sheetName: String, fileName: String) throws -> POSImportResult {
        guard let header = rows.first else {
            throw CSVImportError.unreadableFile
        }

        let normalizedHeader = header.map(normalize)
        let dateIndex = findColumn(in: normalizedHeader, candidates: ["date"])
        let descriptionIndex = findColumn(in: normalizedHeader, candidates: ["descr", "description"])
        let brandIndex = findColumn(in: normalizedHeader, candidates: ["brand"])
        let productIndex = findColumn(in: normalizedHeader, candidates: ["product"])
        let colorIndex = findColumn(in: normalizedHeader, candidates: ["color", "colour"])
        let quantityIndex = findColumn(in: normalizedHeader, candidates: ["quantity", "qty"])
        let totalPriceIndex = findColumn(in: normalizedHeader, candidates: ["totalprice", "sales", "amount"])

        var missing: [String] = []
        if dateIndex == nil { missing.append("Date") }
        if productIndex == nil { missing.append("Product") }
        if quantityIndex == nil { missing.append("Quantity") }
        if totalPriceIndex == nil { missing.append("Total Price") }
        if !missing.isEmpty { throw CSVImportError.missingRequiredColumns(missing) }

        let customerName = customerName(from: sheetName)
        var records: [SalesRecord] = []
        var skippedCount = 0

        for row in rows.dropFirst() {
            guard let quantityIndex,
                  let totalPriceIndex,
                  let rawDate = value(at: dateIndex, in: row),
                  let salesDate = parseDate(rawDate),
                  let rawProduct = value(at: productIndex, in: row),
                  let amount = value(at: totalPriceIndex, in: row).flatMap(parseDecimal),
                  let units = value(at: quantityIndex, in: row).flatMap(parseInteger) else {
                skippedCount += 1
                continue
            }

            let productIdentifier = parseRebelRagsProductIdentifier(rawProduct)
            let colorLookup = value(at: colorIndex, in: row).map(rebelRagsColor)

            records.append(
                SalesRecord(
                    customerName: customerName,
                    date: salesDate,
                    amount: amount,
                    units: units,
                    sourceFile: fileName,
                    productClass: normalizedBrandClass(value(at: brandIndex, in: row)),
                    masterStyle: value(at: descriptionIndex, in: row),
                    color: colorLookup?.displayName,
                    size: nil,
                    rawStyleIdentifier: rawProduct,
                    styleNumber: productIdentifier.styleNumber,
                    colorCode: colorLookup?.code,
                    catalogColorName: colorLookup?.catalogName ?? colorLookup?.displayName,
                    artCode: productIdentifier.artCode,
                    lastReceived: salesDate
                )
            )
        }

        return POSImportResult(records: records, skippedCount: skippedCount)
    }

    private static func normalize(_ value: String) -> String {
        value.lowercased().filter { $0.isLetter || $0.isNumber }
    }

    private static func findColumn(in header: [String], candidates: [String]) -> Int? {
        if let exactMatch = header.firstIndex(where: { candidates.contains($0) }) {
            return exactMatch
        }

        return header.firstIndex { column in
            candidates.contains { column.contains($0) }
        }
    }

    private static func value(at index: Int?, in row: [String]) -> String? {
        guard let index, row.indices.contains(index) else { return nil }
        let cleaned = row[index]
            .replacingOccurrences(of: "\u{00a0}", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }

    private static func parseInteger(_ rawValue: String) -> Int? {
        let cleaned = rawValue
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return Double(cleaned).map { Int($0.rounded()) }
    }

    private static func parseDecimal(_ rawValue: String) -> Decimal? {
        let cleaned = rawValue
            .replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "(", with: "-")
            .replacingOccurrences(of: ")", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return Decimal(string: cleaned, locale: Locale(identifier: "en_US_POSIX"))
    }

    private static func parseDate(_ rawValue: String) -> Date? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)

        for formatter in dateFormatters {
            if let date = formatter.date(from: trimmed) {
                return date
            }
        }

        return nil
    }

    private static let dateFormatters: [DateFormatter] = {
        let formats = [
            "yyyy-MM-dd",
            "yyyy-MM-dd HH:mm:ss",
            "MM/dd/yyyy",
            "M/d/yyyy",
            "MM/dd/yyyy HH:mm:ss",
            "M/d/yyyy HH:mm:ss",
            "MM/dd/yy",
            "M/d/yy",
            "MM/dd/yy HH:mm:ss",
            "M/d/yy HH:mm:ss",
            "yyyy/MM/dd",
            "MMM yyyy",
            "MMMM yyyy",
            "yyyy-MM",
            "yyyy-MM-dd'T'HH:mm:ss",
            "MMM d yy",
            "MMM d yyyy",
            "MMMM d yy",
            "MMMM d yyyy"
        ]

        return formats.map { format in
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = format
            formatter.isLenient = false
            formatter.twoDigitStartDate = Calendar.reporting.date(from: DateComponents(year: 2000, month: 1, day: 1))
            return formatter
        }
    }()

    static func reportDate(from fileName: String) -> Date? {
        let nameWithoutExtension = (fileName as NSString).deletingPathExtension
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        if let date = parseReportDateTokens(from: nameWithoutExtension) {
            return date
        }

        let candidates = [
            nameWithoutExtension,
            nameWithoutExtension.replacingOccurrences(of: "Sept", with: "Sep"),
            nameWithoutExtension.replacingOccurrences(of: "sept", with: "Sep")
        ]

        return candidates.compactMap(parseDate).first
    }

    static func salesPeriodDate(fromFileName fileName: String, receivedDate: Date? = nil) -> Date? {
        if let receivedDate,
           let salesDate = salesPeriodDate(from: receivedDate) {
            return salesDate
        }

        let nameWithoutExtension = (fileName as NSString).deletingPathExtension
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        return parseSalesMonthTokens(from: nameWithoutExtension)
    }

    private static func parseReportDateTokens(from value: String) -> Date? {
        let tokens = value
            .lowercased()
            .replacingOccurrences(of: ",", with: " ")
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init)

        guard let monthIndex = tokens.firstIndex(where: { reportMonthNumbers[$0] != nil }),
              tokens.indices.contains(monthIndex + 2),
              let month = reportMonthNumbers[tokens[monthIndex]],
              let day = Int(tokens[monthIndex + 1]),
              var year = Int(tokens[monthIndex + 2]) else {
            return nil
        }

        if year < 100 {
            year += 2000
        }

        guard (2024...2026).contains(year) else {
            return nil
        }

        return Calendar.reporting.date(from: DateComponents(year: year, month: month, day: day))
    }

    private static func parseSalesMonthTokens(from value: String) -> Date? {
        let normalized = value
            .lowercased()
            .replacingOccurrences(of: ",", with: " ")
        let tokens = normalized
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init)

        if let monthIndex = tokens.firstIndex(where: { reportMonthNumbers[$0] != nil }),
           let month = reportMonthNumbers[tokens[monthIndex]],
           let year = salesYear(after: monthIndex, in: tokens) {
            return Calendar.reporting.date(from: DateComponents(year: year, month: month, day: 1))
        }

        for (monthName, monthNumber) in reportMonthNumbers {
            if let year = compactSalesYear(after: monthName, in: normalized) {
                return Calendar.reporting.date(from: DateComponents(year: year, month: monthNumber, day: 1))
            }
        }

        return nil
    }

    private static func salesYear(after monthIndex: Int, in tokens: [String]) -> Int? {
        for token in tokens.dropFirst(monthIndex + 1) {
            if let year = normalizedSalesYear(from: token) {
                return year
            }
        }
        return nil
    }

    private static func compactSalesYear(after monthName: String, in value: String) -> Int? {
        guard let range = value.range(of: monthName) else { return nil }
        let tail = value[range.upperBound...]
        let digits = tail.prefix { $0.isNumber }
        return normalizedSalesYear(from: String(digits))
    }

    private static func normalizedSalesYear(from value: String) -> Int? {
        guard !value.isEmpty, var year = Int(value) else { return nil }
        if year < 100 {
            year += 2000
        }
        guard (2024...2026).contains(year) else { return nil }
        return year
    }

    private static func parseRebelRagsProductIdentifier(_ rawValue: String) -> RebelRagsProductIdentifier {
        let tokens = rawValue
            .uppercased()
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init)

        let styleNumber = tokens.last { token in
            isRebelRagsStyleToken(token)
        }

        let artCodeToken = tokens.first { token in
            guard token != styleNumber else { return false }
            return isRebelRagsArtCodeToken(token)
        }
        let artCode = artCodeToken.map(normalizedRebelRagsArtCode)

        return RebelRagsProductIdentifier(styleNumber: styleNumber, artCode: artCode)
    }

    private static func isRebelRagsStyleToken(_ token: String) -> Bool {
        token.contains(where: \.isLetter)
            && token.contains(where: \.isNumber)
            && token.count >= 4
            && !isRebelRagsArtCodeToken(token)
    }

    private static func isRebelRagsArtCodeToken(_ token: String) -> Bool {
        if token.range(of: #"^(APC|APO|AEC|AE|AP)[A-Z0-9]+$"#, options: .regularExpression) != nil {
            return true
        }
        if token.range(of: #"^[A-Z]{1,3}[0-9]{6,}$"#, options: .regularExpression) != nil {
            return true
        }
        return token.count >= 6 && token.allSatisfy(\.isNumber)
    }

    private static func normalizedRebelRagsArtCode(_ token: String) -> String {
        if token.range(of: #"^[A-Z]{1,3}[0-9]{6,}$"#, options: .regularExpression) != nil {
            let digits = token.drop { $0.isLetter }
            return String(digits)
        }
        return token
    }

    private static func rebelRagsColor(_ rawValue: String) -> RebelRagsColor {
        let displayName = rawValue
            .replacingOccurrences(of: "_", with: " ")
            .lowercased()
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")

        let normalizedName = normalizedColorName(displayName)
        let code = colorCodesByNormalizedName[normalizedName]
            ?? rebelRagsColorAliases[normalizedName]
        let catalogName = code.flatMap { ProductCatalog.colorNamesByCode[$0] }

        return RebelRagsColor(code: code, displayName: displayName, catalogName: catalogName)
    }

    private static func normalizedBrandClass(_ value: String?) -> String? {
        guard let value else { return nil }
        let cleaned = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
        guard !cleaned.isEmpty else { return nil }
        if cleaned.contains("COMFORT") || cleaned.contains("C WASH") || cleaned.contains("CWASH") {
            return "GEAR"
        }
        return cleaned
    }

    private static func normalizedColorName(_ value: String) -> String {
        normalize(value)
            .replacingOccurrences(of: "gray", with: "grey")
    }

    private static let colorCodesByNormalizedName: [String: String] = {
        ProductCatalog.colorNamesByCode.reduce(into: [:]) { result, item in
            let normalizedName = normalizedColorName(item.value)
            if result[normalizedName] == nil {
                result[normalizedName] = item.key
            }
        }
    }()

    private static let rebelRagsColorAliases: [String: String] = [
        "heathergrey": "930",
        "silvergrey": "940",
        "graniteheather": "990",
        "lightblue": "1616",
        "navy": "190",
        "midnightnavy": "190",
        "white": "000",
        "black": "999",
        "scarlet": "529",
        "graphite": "972",
        "oatmeal": "7091",
        "ivorycanvas": "7004",
        "lilacpink": "5113",
        "manhattanmist": "9022"
    ]

    private static let reportMonthNumbers = [
        "jan": 1,
        "january": 1,
        "feb": 2,
        "february": 2,
        "mar": 3,
        "march": 3,
        "apr": 4,
        "april": 4,
        "may": 5,
        "jun": 6,
        "june": 6,
        "jul": 7,
        "july": 7,
        "aug": 8,
        "august": 8,
        "sep": 9,
        "sept": 9,
        "september": 9,
        "oct": 10,
        "october": 10,
        "nov": 11,
        "november": 11,
        "dec": 12,
        "december": 12
    ]

    static func salesPeriodDate(from receivedDate: Date) -> Date? {
        guard let priorMonth = Calendar.reporting.date(byAdding: .month, value: -1, to: receivedDate) else {
            return nil
        }

        return Calendar.reporting.monthStart(for: priorMonth)
    }

    private static func customerName(from sheetName: String) -> String {
        if sheetName.range(of: #"^Sheet\d*$"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return "Volshop"
        }

        var name = sheetName
        if name.hasPrefix("Monthly") {
            name.removeFirst("Monthly".count)
        }

        if let range = name.range(of: "Sales", options: [.caseInsensitive]) {
            name = String(name[..<range.lowerBound])
        }

        return name.isEmpty ? sheetName : name
    }

    private static func parseRows(from text: String) -> [[String]] {
        var rows: [[String]] = []
        var currentRow: [String] = []
        var currentField = ""
        var isInsideQuotes = false
        var iterator = text.makeIterator()

        while let character = iterator.next() {
            switch character {
            case "\"":
                if isInsideQuotes, let next = iterator.next() {
                    if next == "\"" {
                        currentField.append("\"")
                    } else {
                        isInsideQuotes.toggle()
                        consumeDelimiterOrCharacter(next, field: &currentField, row: &currentRow, rows: &rows)
                    }
                } else {
                    isInsideQuotes.toggle()
                }
            case "," where !isInsideQuotes:
                currentRow.append(currentField)
                currentField = ""
            case "\n" where !isInsideQuotes:
                currentRow.append(currentField)
                rows.append(currentRow)
                currentRow = []
                currentField = ""
            case "\r":
                continue
            default:
                currentField.append(character)
            }
        }

        if !currentField.isEmpty || !currentRow.isEmpty {
            currentRow.append(currentField)
            rows.append(currentRow)
        }

        return rows.filter { row in
            row.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        }
    }

    private static func consumeDelimiterOrCharacter(
        _ character: Character,
        field: inout String,
        row: inout [String],
        rows: inout [[String]]
    ) {
        switch character {
        case ",":
            row.append(field)
            field = ""
        case "\n":
            row.append(field)
            rows.append(row)
            row = []
            field = ""
        case "\r":
            break
        default:
            field.append(character)
        }
    }
}

private struct RebelRagsProductIdentifier {
    let styleNumber: String?
    let artCode: String?
}

private struct RebelRagsColor {
    let code: String?
    let displayName: String
    let catalogName: String?
}

private final class SpreadsheetXMLParser: NSObject, XMLParserDelegate {
    struct Sheet {
        let name: String
        var rows: [[String]]
    }

    private(set) var sheets: [Sheet] = []
    private var activeSheetName = "Sheet1"
    private var activeRows: [[String]] = []
    private var activeRow: [String] = []
    private var activeCellIndex = 1
    private var activeData = ""
    private var isInsideWorksheet = false
    private var isInsideRow = false
    private var isInsideCell = false
    private var isInsideData = false

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        switch elementName {
        case "Worksheet":
            activeSheetName = attributeDict.xmlAttribute(named: "Name") ?? "Sheet\(sheets.count + 1)"
            activeRows = []
            isInsideWorksheet = true
        case "Row" where isInsideWorksheet:
            activeRow = []
            activeCellIndex = 1
            isInsideRow = true
        case "Cell" where isInsideRow:
            if let explicitIndex = attributeDict.xmlAttribute(named: "Index").flatMap(Int.init) {
                while activeCellIndex < explicitIndex {
                    activeRow.append("")
                    activeCellIndex += 1
                }
            }
            activeData = ""
            isInsideCell = true
        case "Data" where isInsideCell:
            activeData = ""
            isInsideData = true
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if isInsideData {
            activeData += string
        }
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        switch elementName {
        case "Data":
            isInsideData = false
        case "Cell":
            activeRow.append(activeData)
            activeCellIndex += 1
            isInsideCell = false
        case "Row":
            if activeRow.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
                activeRows.append(activeRow)
            }
            isInsideRow = false
        case "Worksheet":
            sheets.append(Sheet(name: activeSheetName, rows: activeRows))
            isInsideWorksheet = false
        default:
            break
        }
    }
}

private extension Dictionary where Key == String, Value == String {
    func xmlAttribute(named name: String) -> String? {
        first { key, _ in
            key == name || key.hasSuffix(":\(name)")
        }?.value
    }
}
