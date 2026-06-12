import Foundation

struct SalesRecord: Identifiable, Codable, Hashable {
    var id: UUID
    var customerName: String
    var date: Date
    var receivedDate: Date?
    var amount: Decimal
    var units: Int?
    var sourceFile: String
    var productClass: String?
    var masterStyle: String?
    var color: String?
    var size: String?
    var rawStyleIdentifier: String?
    var styleNumber: String?
    var colorCode: String?
    var catalogColorName: String?
    var artCode: String?
    var lastReceived: Date?
    var currentRetail: Decimal?
    var yearToDateAmount: Decimal?
    var yearToDateUnits: Int?
    var inventoryUnits: Int?
    var inventoryRetailValue: Decimal?

    init(
        id: UUID = UUID(),
        customerName: String,
        date: Date,
        receivedDate: Date? = nil,
        amount: Decimal,
        units: Int? = nil,
        sourceFile: String,
        productClass: String? = nil,
        masterStyle: String? = nil,
        color: String? = nil,
        size: String? = nil,
        rawStyleIdentifier: String? = nil,
        styleNumber: String? = nil,
        colorCode: String? = nil,
        catalogColorName: String? = nil,
        artCode: String? = nil,
        lastReceived: Date? = nil,
        currentRetail: Decimal? = nil,
        yearToDateAmount: Decimal? = nil,
        yearToDateUnits: Int? = nil,
        inventoryUnits: Int? = nil,
        inventoryRetailValue: Decimal? = nil
    ) {
        self.id = id
        self.customerName = customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        self.date = date
        self.receivedDate = receivedDate
        self.amount = amount
        self.units = units
        self.sourceFile = sourceFile
        self.productClass = productClass?.cleanedOptional
        self.masterStyle = masterStyle?.cleanedOptional
        self.color = color?.cleanedOptional
        self.size = size?.cleanedOptional
        self.rawStyleIdentifier = rawStyleIdentifier?.cleanedOptional
        self.styleNumber = styleNumber?.cleanedOptional
        self.colorCode = colorCode?.cleanedOptional
        self.catalogColorName = catalogColorName?.cleanedOptional
        self.artCode = artCode?.cleanedOptional
        self.lastReceived = lastReceived
        self.currentRetail = currentRetail
        self.yearToDateAmount = yearToDateAmount
        self.yearToDateUnits = yearToDateUnits
        self.inventoryUnits = inventoryUnits
        self.inventoryRetailValue = inventoryRetailValue
    }
}

private extension String {
    var cleanedOptional: String? {
        let cleaned = replacingOccurrences(of: "\u{00a0}", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }
}

struct ImportSummary: Identifiable {
    let id = UUID()
    let fileName: String
    let importedCount: Int
    let skippedCount: Int
    let salesMonth: Date?
    let receivedDate: Date?
    let status: ImportStatus
    let message: String
}

enum ImportStatus: String, Codable {
    case imported = "Imported"
    case warning = "Warning"
    case duplicate = "Duplicate"
}

struct ImportBatch: Identifiable, Hashable {
    var id: String { "\(customerName)-\(sourceFile)-\(salesMonth.timeIntervalSince1970)" }
    let customerName: String
    let sourceFile: String
    let salesMonth: Date
    let receivedDate: Date?
    let rowCount: Int
    let sales: Decimal
    let units: Int

    var salesDouble: Double {
        NSDecimalNumber(decimal: sales).doubleValue
    }
}

enum Period: String, CaseIterable, Identifiable {
    case monthly = "Monthly"
    case yearly = "Yearly"

    var id: String { rawValue }
}

struct SalesBucket: Identifiable, Hashable {
    let id = UUID()
    let periodStart: Date
    let customerName: String
    let amount: Decimal
    let units: Int

    var amountDouble: Double {
        NSDecimalNumber(decimal: amount).doubleValue
    }

    var periodLabel: String {
        periodStart.salesLensMonthText
    }
}

struct TopSeller: Identifiable, Hashable {
    var id: String { "\(brandName)-\(styleNumber)-\(colorName)-\(artCode)" }
    let rank: Int
    let brandName: String
    let styleNumber: String
    let styleName: String
    let colorName: String
    let artCode: String
    let sales: Decimal
    let units: Int
    let currentYearSales: Decimal
    let currentYearUnits: Int
    let rowCount: Int
    let inventoryUnits: Int
    let priorYearInventoryUnits: Int?

    var salesDouble: Double {
        NSDecimalNumber(decimal: sales).doubleValue
    }

    var inventoryChangeUnits: Int? {
        priorYearInventoryUnits.map { inventoryUnits - $0 }
    }
}

struct BestSalesDaySummary: Hashable {
    let date: Date?
    let usesDailyTransactions: Bool
    let sales: Decimal
    let units: Int
    let transactions: Int
    let topItems: [BestSalesDayItem]
}

struct BestSalesDayItem: Identifiable, Hashable {
    var id: String { "\(styleNumber)-\(colorName)-\(artCode)" }
    let rank: Int
    let styleNumber: String
    let colorName: String
    let artCode: String
    let sales: Decimal
    let units: Int
}

struct TopStyle: Identifiable, Hashable {
    var id: String { "\(brandName)-\(styleNumber)" }
    let rank: Int
    let brandName: String
    let styleNumber: String
    let styleName: String
    let sales: Decimal
    let units: Int
    let rowCount: Int
    let inventoryUnits: Int
    let colorCount: Int
    let artCount: Int
    let artCodes: String
    let artDetails: String

    var salesDouble: Double {
        NSDecimalNumber(decimal: sales).doubleValue
    }
}

struct TopStyleMonthComparison: Identifiable, Hashable {
    var id: String { "\(brandName)-\(styleNumber)" }
    let rank: Int
    let brandName: String
    let styleNumber: String
    let styleName: String
    let currentUnits: Int
    let priorYearUnits: Int
    let currentSales: Decimal
    let priorYearSales: Decimal
    let colorCount: Int
    let artCount: Int
    let artCodes: String
    let priorYearColorCount: Int
    let priorYearArtCount: Int
    let priorYearArtCodes: String

    var unitChange: Int {
        currentUnits - priorYearUnits
    }

    var artCountChange: Int {
        artCount - priorYearArtCount
    }

    var salesChange: Decimal {
        currentSales - priorYearSales
    }

    var unitPercentChange: Double? {
        guard priorYearUnits != 0 else { return nil }
        return (Double(currentUnits - priorYearUnits) / Double(priorYearUnits)) * 100
    }

    var salesPercentChange: Double? {
        let prior = NSDecimalNumber(decimal: priorYearSales).doubleValue
        guard prior != 0 else { return nil }
        let current = NSDecimalNumber(decimal: currentSales).doubleValue
        return ((current - prior) / prior) * 100
    }
}

enum StyleSignalKind: String, CaseIterable, Hashable {
    case growthDrivers
    case decliners
    case assortmentExpansion
    case assortmentContraction
    case efficientWinners
    case missingLastYearSellers

    var title: String {
        switch self {
        case .growthDrivers:
            return "Growth Drivers"
        case .decliners:
            return "Decliners"
        case .assortmentExpansion:
            return "Assortment Expansion"
        case .assortmentContraction:
            return "Assortment Contraction"
        case .efficientWinners:
            return "Efficient Winners"
        case .missingLastYearSellers:
            return "Missing LY Sellers"
        }
    }

    var subtitle: String {
        switch self {
        case .growthDrivers:
            return "Styles adding the most sales vs last year."
        case .decliners:
            return "Styles giving back the most sales vs last year."
        case .assortmentExpansion:
            return "Styles with more colors or artworks in market."
        case .assortmentContraction:
            return "Styles with fewer colors or artworks in market."
        case .efficientWinners:
            return "Styles growing with the same or less assortment."
        case .missingLastYearSellers:
            return "Styles that sold last year but not in this period."
        }
    }
}

struct StyleSignalGroup: Identifiable, Hashable {
    var id: StyleSignalKind { kind }
    let kind: StyleSignalKind
    let items: [StyleSignalItem]
}

struct StyleSignalItem: Identifiable, Hashable {
    var id: String { "\(brandName)-\(styleNumber)" }
    let rank: Int
    let brandName: String
    let styleNumber: String
    let styleName: String
    let currentSales: Decimal
    let priorYearSales: Decimal
    let currentUnits: Int
    let priorYearUnits: Int
    let colorCount: Int
    let priorYearColorCount: Int
    let artCount: Int
    let priorYearArtCount: Int

    var salesChange: Decimal {
        currentSales - priorYearSales
    }

    var salesChangeDouble: Double {
        NSDecimalNumber(decimal: salesChange).doubleValue
    }

    var unitChange: Int {
        currentUnits - priorYearUnits
    }

    var assortmentChange: Int {
        (colorCount - priorYearColorCount) + (artCount - priorYearArtCount)
    }

    var salesPercentChange: Double? {
        let prior = NSDecimalNumber(decimal: priorYearSales).doubleValue
        guard prior != 0 else { return nil }
        let current = NSDecimalNumber(decimal: currentSales).doubleValue
        return ((current - prior) / prior) * 100
    }
}

struct VolshopClassSlice: Identifiable, Hashable {
    var id: String { name }
    let name: String
    let units: Int

    var unitsDouble: Double {
        Double(units)
    }
}

struct MonthComparison: Hashable {
    let currentMonth: Date
    let priorYearMonth: Date
    let currentSales: Decimal
    let priorYearSales: Decimal
    let currentUnits: Int
    let priorYearUnits: Int
    let currentTransactions: Int
    let priorYearTransactions: Int
    let currentInventoryUnits: Int
    let priorYearInventoryUnits: Int

    var salesPercentChange: Double? {
        let prior = NSDecimalNumber(decimal: priorYearSales).doubleValue
        guard prior != 0 else { return nil }
        let current = NSDecimalNumber(decimal: currentSales).doubleValue
        return ((current - prior) / prior) * 100
    }

    var inventoryPercentChange: Double? {
        guard priorYearInventoryUnits != 0 else { return nil }
        return (Double(currentInventoryUnits - priorYearInventoryUnits) / Double(priorYearInventoryUnits)) * 100
    }

    var directionText: String {
        guard let salesPercentChange else { return "no prior sales" }
        return salesPercentChange >= 0 ? "up" : "down"
    }

    var inventoryDirectionText: String {
        guard let inventoryPercentChange else { return "no prior inventory" }
        return inventoryPercentChange >= 0 ? "up" : "down"
    }
}

struct YearToDateComparison: Hashable {
    let currentYear: Int
    let priorYear: Int
    let throughMonth: Date
    let currentSales: Decimal
    let priorYearSales: Decimal
    let months: [YearToDateMonthComparison]

    var salesDifference: Decimal {
        currentSales - priorYearSales
    }

    var salesPercentChange: Double? {
        let prior = NSDecimalNumber(decimal: priorYearSales).doubleValue
        guard prior != 0 else { return nil }
        let current = NSDecimalNumber(decimal: currentSales).doubleValue
        return ((current - prior) / prior) * 100
    }

    var directionText: String {
        guard let salesPercentChange else { return "no prior sales" }
        return salesPercentChange >= 0 ? "ahead" : "behind"
    }
}

struct YearToDateMonthComparison: Identifiable, Hashable {
    var id: Int { monthNumber }
    let monthNumber: Int
    let monthName: String
    let currentSales: Decimal
    let priorYearSales: Decimal
    let currentRunningSales: Decimal
    let priorYearRunningSales: Decimal

    var salesDifference: Decimal {
        currentSales - priorYearSales
    }

    var runningSalesDifference: Decimal {
        currentRunningSales - priorYearRunningSales
    }

    var salesPercentChange: Double? {
        let prior = NSDecimalNumber(decimal: priorYearSales).doubleValue
        guard prior != 0 else { return nil }
        let current = NSDecimalNumber(decimal: currentSales).doubleValue
        return ((current - prior) / prior) * 100
    }

    var runningSalesPercentChange: Double? {
        let prior = NSDecimalNumber(decimal: priorYearRunningSales).doubleValue
        guard prior != 0 else { return nil }
        let current = NSDecimalNumber(decimal: currentRunningSales).doubleValue
        return ((current - prior) / prior) * 100
    }

    var directionText: String {
        guard let salesPercentChange else { return "no prior sales" }
        return salesPercentChange >= 0 ? "over" : "behind"
    }

    var runningDirectionText: String {
        guard let runningSalesPercentChange else { return "no prior sales" }
        return runningSalesPercentChange >= 0 ? "over" : "behind"
    }
}

extension Calendar {
    static let reporting = Calendar(identifier: .gregorian)

    func monthStart(for date: Date) -> Date {
        let components = dateComponents([.year, .month], from: date)
        return self.date(from: components) ?? date
    }

    func yearStart(for date: Date) -> Date {
        let components = dateComponents([.year], from: date)
        return self.date(from: components) ?? date
    }
}
