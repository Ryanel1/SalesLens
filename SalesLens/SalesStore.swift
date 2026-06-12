import Foundation

@MainActor
final class SalesStore: ObservableObject {
    @Published private(set) var records: [SalesRecord] = [] {
        didSet { invalidateDataCaches() }
    }
    @Published private(set) var accountNames: [String] = ["Volshop"]
    @Published var selectedCustomer: String? = nil {
        didSet {
            if selectedCustomer != oldValue {
                invalidateFilterCaches()
            }
        }
    }
    @Published var selectedBrandName: String? = nil {
        didSet {
            if selectedBrandName != oldValue {
                invalidateFilterCaches()
            }
        }
    }
    @Published var period: Period = .monthly {
        didSet {
            if period != oldValue {
                invalidatePeriodCaches()
            }
        }
    }
    @Published var selectedComparisonMonthKeys: Set<String> = []
    @Published var selectedTopSellerMonthKey: String? = nil {
        didSet {
            if selectedTopSellerMonthKey != oldValue {
                invalidatePeriodCaches()
            }
        }
    }
    @Published var importSummary: ImportSummary?
    @Published var importError: String?

    private let persistenceURL: URL
    private let accountsURL: URL
    private var cachedImportBatches: [ImportBatch]?
    private var cachedFilteredRecords: [SalesRecord]?
    private var cachedFilteredImportBatches: [ImportBatch]?
    private var cachedAvailableSalesMonths: [Date]?
    private var cachedSelectedPeriodBatches: [ImportBatch]?
    private var cachedCurrentPeriodRecords: [SalesRecord]?
    private var cachedPriorYearPeriodRecords: [SalesRecord]?
    private var cachedStyleSummaries: [StyleSummary]?
    private var cachedTopSellers: [TopSeller]?
    private var cachedTopStyles: [TopStyle]?
    private var cachedTopStylesByUnits: [TopStyle]?
    private var cachedMonthlyStylesByUnits: [TopStyle]?
    private var cachedTopStyleMonthComparisons: [TopStyleMonthComparison]?
    private var cachedStyleSignalGroups: [StyleSignalGroup]?
    private var cachedSelectedCustomerClassMix: [VolshopClassSlice]?
    private var cachedBestSalesDaySummary: BestSalesDaySummary??
    private var cachedYearToDateComparison: YearToDateComparison??
    private var cachedYearOverYearComparison: MonthComparison??
    private var cachedLatestUploadedDateByCustomer: [String: Date]?

    init() {
        SalesLensDataLocation.migrateLegacyDataIfNeeded()
        let appDirectory = SalesLensDataLocation.sharedDirectory
        self.persistenceURL = appDirectory.appendingPathComponent("sales-records.json")
        self.accountsURL = appDirectory.appendingPathComponent("accounts.json")
        load()
    }

    var customers: [String] {
        Array(Set(accountNames + records.map(\.customerName))).sorted()
    }

    var availableBrandNames: [String] {
        ["CHAMPION", "GEAR"]
    }

    var selectedBrandDisplayText: String {
        selectedBrandName.map(brandDisplayName) ?? "All"
    }

    var uploadCoverageLines: [(customer: String, value: String)] {
        let customersToShow = selectedCustomer.map { [$0] } ?? customers
        return customersToShow.compactMap { customer in
            guard let date = latestUploadedDateByCustomer[customer] else { return nil }
            let value = customer.caseInsensitiveCompare("Rebel Rags") == .orderedSame
                ? date.salesLensDateText
                : "\(date.salesLensMonthText) sales"
            return (customer, value)
        }
    }

    var filteredRecords: [SalesRecord] {
        if let cachedFilteredRecords {
            return cachedFilteredRecords
        }

        let brandFiltered = selectedBrandName.map { selectedBrand in
            customerFilteredRecords.filter { matchesBrandFilter(record: $0, selectedBrand: selectedBrand) }
        } ?? customerFilteredRecords

        let result = brandFiltered.sorted { $0.date > $1.date }
        cachedFilteredRecords = result
        return result
    }

    var filterEmptyMessage: String? {
        guard !records.isEmpty, filteredRecords.isEmpty else { return nil }

        if let selectedBrandName {
            let matchingCustomers = Array(Set(records
                .filter { matchesBrandFilter(record: $0, selectedBrand: selectedBrandName) }
                .map(\.customerName)))
                .sorted()
            let brandText = brandDisplayName(selectedBrandName)

            if let selectedCustomer, !matchingCustomers.isEmpty {
                return "\(brandText) rows are imported under \(matchingCustomers.joined(separator: ", ")), not \(selectedCustomer). Select All Customers or that account in the sidebar to view them."
            }

            return "No \(brandText) rows match the current account and month filters."
        }

        return "No records match the current filters."
    }

    private var customerFilteredRecords: [SalesRecord] {
        selectedCustomer.map { customer in
            records.filter { $0.customerName == customer }
        } ?? records
    }

    var filteredImportBatches: [ImportBatch] {
        if let cachedFilteredImportBatches {
            return cachedFilteredImportBatches
        }

        let result = importBatches(from: filteredRecords)
            .sorted { $0.salesMonth > $1.salesMonth }
        cachedFilteredImportBatches = result
        return result
    }

    var totalSales: Decimal {
        filteredImportBatches.reduce(Decimal(0)) { $0 + $1.sales }
    }

    var totalUnits: Int {
        filteredImportBatches.reduce(0) { $0 + $1.units }
    }

    var importBatches: [ImportBatch] {
        if let cachedImportBatches {
            return cachedImportBatches
        }

        let result = importBatches(from: records)
        cachedImportBatches = result
        return result
    }

    private func importBatches(from records: [SalesRecord]) -> [ImportBatch] {
        let grouped = Dictionary(grouping: records) { record in
            BatchKey(
                customerName: record.customerName,
                sourceFile: record.sourceFile,
                salesMonth: Calendar.reporting.monthStart(for: record.date)
            )
        }

        return grouped.map { key, records in
            ImportBatch(
                customerName: key.customerName,
                sourceFile: key.sourceFile,
                salesMonth: key.salesMonth,
                receivedDate: records.compactMap(\.receivedDate).min(),
                rowCount: records.count,
                sales: records.reduce(Decimal(0)) { $0 + $1.amount },
                units: records.compactMap(\.units).reduce(0, +)
            )
        }
        .sorted { $0.salesMonth > $1.salesMonth }
    }

    var duplicateMonthCount: Int {
        importBatches.count - canonicalImportBatches(from: records).count
    }

    var buckets: [SalesBucket] {
        let grouped = Dictionary(grouping: filteredImportBatches) { batch in
            let start = period == .monthly
                ? Calendar.reporting.monthStart(for: batch.salesMonth)
                : Calendar.reporting.yearStart(for: batch.salesMonth)
            return BucketKey(periodStart: start, customerName: batch.customerName)
        }

        return grouped.map { key, batches in
            SalesBucket(
                periodStart: key.periodStart,
                customerName: key.customerName,
                amount: batches.reduce(Decimal(0)) { $0 + $1.sales },
                units: batches.reduce(0) { $0 + $1.units }
            )
        }
        .sorted {
            if $0.periodStart == $1.periodStart {
                return $0.customerName < $1.customerName
            }
            return $0.periodStart < $1.periodStart
        }
    }

    var availableSalesMonths: [Date] {
        if let cachedAvailableSalesMonths {
            return cachedAvailableSalesMonths
        }

        let result = Array(Set(filteredImportBatches.map(\.salesMonth)))
            .sorted(by: >)
        cachedAvailableSalesMonths = result
        return result
    }

    var selectedSalesMonth: Date? {
        if let selectedTopSellerMonthKey,
           let month = availableSalesMonths.first(where: { monthKey(for: $0) == selectedTopSellerMonthKey }) {
            return month
        }

        return availableSalesMonths.first
    }

    var selectedMonthBatches: [ImportBatch] {
        guard let selectedSalesMonth else { return [] }
        let selectedKey = monthKey(for: selectedSalesMonth)
        return filteredImportBatches.filter { monthKey(for: $0.salesMonth) == selectedKey }
    }

    var selectedMonthSales: Decimal {
        selectedMonthBatches.reduce(Decimal(0)) { $0 + $1.sales }
    }

    var selectedMonthTransactions: Int {
        selectedMonthBatches.reduce(0) { $0 + $1.rowCount }
    }

    var selectedMonthUnits: Int {
        selectedMonthBatches.reduce(0) { $0 + $1.units }
    }

    var selectedPeriodTitle: String {
        guard let selectedSalesMonth else { return "No sales month selected" }
        switch period {
        case .monthly:
            return selectedSalesMonth.salesLensMonthText
        case .yearly:
            return yearToDateTitle(for: selectedSalesMonth)
        }
    }

    var selectedPriorYearPeriodTitle: String? {
        guard let selectedSalesMonth,
              let priorYearMonth = Calendar.reporting.date(byAdding: .year, value: -1, to: selectedSalesMonth) else {
            return nil
        }

        switch period {
        case .monthly:
            return priorYearMatch(for: selectedSalesMonth)?.salesLensMonthText
        case .yearly:
            return yearToDateTitle(for: priorYearMonth)
        }
    }

    var selectedPeriodBatches: [ImportBatch] {
        guard let selectedSalesMonth else { return [] }
        if let cachedSelectedPeriodBatches {
            return cachedSelectedPeriodBatches
        }

        let result = filteredImportBatches.filter {
            isInSelectedPeriod($0.salesMonth, relativeTo: selectedSalesMonth)
        }
        cachedSelectedPeriodBatches = result
        return result
    }

    var selectedPeriodSales: Decimal {
        selectedPeriodBatches.reduce(Decimal(0)) { $0 + $1.sales }
    }

    var selectedPeriodTransactions: Int {
        selectedPeriodBatches.reduce(0) { $0 + $1.rowCount }
    }

    var selectedPeriodUnits: Int {
        selectedPeriodBatches.reduce(0) { $0 + $1.units }
    }

    var salesMixCustomerName: String? {
        guard let selectedCustomer,
              selectedCustomer.caseInsensitiveCompare("Volshop") == .orderedSame
                || selectedCustomer.caseInsensitiveCompare("Rebel Rags") == .orderedSame else {
            return nil
        }
        return selectedCustomer
    }

    var selectedCustomerClassMix: [VolshopClassSlice] {
        if let cachedSelectedCustomerClassMix {
            return cachedSelectedCustomerClassMix
        }

        guard let salesMixCustomerName else { return [] }
        let periodRecords = currentPeriodRecords.filter {
            $0.customerName.caseInsensitiveCompare(salesMixCustomerName) == .orderedSame
        }

        let totals: [String: Int]
        if salesMixCustomerName.caseInsensitiveCompare("Rebel Rags") == .orderedSame {
            let styleAudience = rebelRagsAudienceByStyle()
            totals = Dictionary(grouping: periodRecords) { record in
                styleAudience[normalizedStyleNumber(for: record)] ?? "Unisex"
            }
            .mapValues { records in
                records.compactMap(\.units).reduce(0, +)
            }
        } else {
            totals = Dictionary(grouping: periodRecords, by: volshopAudience(for:))
                .mapValues { records in
                    records.compactMap(\.units).reduce(0, +)
                }
        }

        let result: [VolshopClassSlice] = ["Unisex", "Women's", "Youth"].compactMap { audience in
            guard let units = totals[audience], units > 0 else { return nil }
            return VolshopClassSlice(name: audience, units: units)
        }
        cachedSelectedCustomerClassMix = result
        return result
    }

    var bestSalesDaySummary: BestSalesDaySummary? {
        if let cachedBestSalesDaySummary {
            return cachedBestSalesDaySummary
        }

        let periodRecords = currentPeriodRecords
        guard !periodRecords.isEmpty else {
            cachedBestSalesDaySummary = .some(nil)
            return nil
        }

        let usesDailyTransactions = selectedCustomer?.caseInsensitiveCompare("Rebel Rags") == .orderedSame
        let selectedDate: Date?
        let highlightRecords: [SalesRecord]

        if usesDailyTransactions {
            let dayGroups = Dictionary(grouping: periodRecords) {
                Calendar.reporting.startOfDay(for: $0.date)
            }
            guard let bestDay = dayGroups.max(by: { first, second in
                let firstSales = first.value.reduce(Decimal(0)) { $0 + $1.amount }
                let secondSales = second.value.reduce(Decimal(0)) { $0 + $1.amount }
                if firstSales == secondSales {
                    return first.value.compactMap(\.units).reduce(0, +) < second.value.compactMap(\.units).reduce(0, +)
                }
                return firstSales < secondSales
            }) else {
                cachedBestSalesDaySummary = .some(nil)
                return nil
            }
            selectedDate = bestDay.key
            highlightRecords = bestDay.value
        } else {
            selectedDate = nil
            highlightRecords = periodRecords
        }

        let topItems = Dictionary(grouping: highlightRecords, by: topSellerKey(for:))
            .map { key, records in
                BestSalesDayItem(
                    rank: 0,
                    styleNumber: key.styleNumber,
                    colorName: key.colorName,
                    artCode: key.artCode,
                    sales: records.reduce(Decimal(0)) { $0 + $1.amount },
                    units: records.compactMap(\.units).reduce(0, +)
                )
            }
            .sorted {
                if $0.sales == $1.sales { return $0.units > $1.units }
                return $0.sales > $1.sales
            }
            .prefix(5)
            .enumerated()
            .map { index, item in
                BestSalesDayItem(
                    rank: index + 1,
                    styleNumber: item.styleNumber,
                    colorName: item.colorName,
                    artCode: item.artCode,
                    sales: item.sales,
                    units: item.units
                )
            }

        let result = BestSalesDaySummary(
            date: selectedDate,
            usesDailyTransactions: usesDailyTransactions,
            sales: highlightRecords.reduce(Decimal(0)) { $0 + $1.amount },
            units: highlightRecords.compactMap(\.units).reduce(0, +),
            transactions: highlightRecords.count,
            topItems: topItems
        )
        cachedBestSalesDaySummary = .some(result)
        return result
    }

    private func rebelRagsAudienceByStyle() -> [String: String] {
        let allRebelRecords = records.filter {
            $0.customerName.caseInsensitiveCompare("Rebel Rags") == .orderedSame
        }
        let recordsByStyle = Dictionary(grouping: allRebelRecords, by: normalizedStyleNumber(for:))

        return recordsByStyle.mapValues { styleRecords in
            let descriptionText = styleRecords
                .compactMap(\.masterStyle)
                .map(normalizedAudienceDescription)
                .joined(separator: " ")
            if descriptionText.contains("YOUTH")
                || descriptionText.contains("INFANT")
                || descriptionText.contains("TODDLER")
                || descriptionText.contains("BODYSUIT")
                || descriptionText.contains("ONESIE") {
                return "Youth"
            }

            let womenGarmentUnits = styleRecords
                .filter { isWomensGarmentDescription($0.masterStyle) }
                .compactMap(\.units)
                .reduce(0, +)
            let totalUnits = max(styleRecords.compactMap(\.units).reduce(0, +), 1)
            let hasSpecificWomenGarment = descriptionText.contains("CROP")
                || descriptionText.contains("CAMI")
                || descriptionText.contains("HALTER")
                || descriptionText.contains("BIKER SHORT")
                || descriptionText.contains("FLARE")
                || descriptionText.contains("LEGGING")
                || descriptionText.contains("SCOOP NECK")
                || descriptionText.contains("SQUARE NECK")
                || descriptionText.contains("WIDE LEG")

            if hasSpecificWomenGarment || womenGarmentUnits * 4 >= totalUnits {
                return "Women's"
            }
            return "Unisex"
        }
    }

    private func normalizedAudienceDescription(_ value: String) -> String {
        value.uppercased()
            .replacingOccurrences(of: "`", with: "'")
            .replacingOccurrences(of: "’", with: "'")
    }

    private func isWomensGarmentDescription(_ value: String?) -> Bool {
        guard let value else { return false }
        let description = normalizedAudienceDescription(value)
        return description.contains("WMNS")
            || description.contains("WOMEN'S")
            || description.contains("WOMENS")
            || description.contains("WOMEN ")
    }

    private func volshopAudience(for record: SalesRecord) -> String {
        let styleDescription = (record.masterStyle ?? "").uppercased()
        if styleDescription.contains("WMNS")
            || styleDescription.contains("WOMEN'S")
            || styleDescription.contains("WOMENS") {
            return "Women's"
        }
        if styleDescription.contains("YOUTH")
            || styleDescription.contains("INFANT")
            || styleDescription.contains("TODDLER") {
            return "Youth"
        }

        let itemClass = (record.productClass ?? "").uppercased()
        if itemClass.hasPrefix("W-") {
            return "Women's"
        }
        if itemClass.hasPrefix("C-") {
            return "Youth"
        }
        return "Unisex"
    }

    var yearToDateComparison: YearToDateComparison? {
        if let cachedYearToDateComparison {
            return cachedYearToDateComparison
        }

        guard let selectedSalesMonth else {
            cachedYearToDateComparison = .some(nil)
            return nil
        }
        let components = Calendar.reporting.dateComponents([.year, .month], from: selectedSalesMonth)
        guard let currentYear = components.year,
              let throughMonth = components.month else {
            cachedYearToDateComparison = .some(nil)
            return nil
        }

        let priorYear = currentYear - 1
        var currentRunningSales = Decimal(0)
        var priorYearRunningSales = Decimal(0)
        let monthRows = (1...throughMonth).map { monthNumber in
            let currentSales = salesTotal(year: currentYear, month: monthNumber)
            let priorYearSales = salesTotal(year: priorYear, month: monthNumber)
            currentRunningSales += currentSales
            priorYearRunningSales += priorYearSales

            return YearToDateMonthComparison(
                monthNumber: monthNumber,
                monthName: monthName(for: monthNumber),
                currentSales: currentSales,
                priorYearSales: priorYearSales,
                currentRunningSales: currentRunningSales,
                priorYearRunningSales: priorYearRunningSales
            )
        }

        let result = YearToDateComparison(
            currentYear: currentYear,
            priorYear: priorYear,
            throughMonth: selectedSalesMonth,
            currentSales: monthRows.reduce(Decimal(0)) { $0 + $1.currentSales },
            priorYearSales: monthRows.reduce(Decimal(0)) { $0 + $1.priorYearSales },
            months: monthRows
        )
        cachedYearToDateComparison = result
        return result
    }

    var selectedComparisonMonths: [Date] {
        let selectedMonths = availableSalesMonths.filter {
            selectedComparisonMonthKeys.contains(monthKey(for: $0))
        }

        let months = selectedMonths.isEmpty
            ? defaultComparisonMonths
            : selectedMonths

        return months.sorted(by: <)
    }

    var comparisonBuckets: [SalesBucket] {
        let selectedKeys = Set(selectedComparisonMonths.map(monthKey(for:)))
        let batches = filteredImportBatches.filter {
            selectedKeys.contains(monthKey(for: $0.salesMonth))
        }
        let grouped = Dictionary(grouping: batches) { batch in
            BucketKey(
                periodStart: Calendar.reporting.monthStart(for: batch.salesMonth),
                customerName: batch.customerName
            )
        }

        return grouped.map { key, batches in
            SalesBucket(
                periodStart: key.periodStart,
                customerName: key.customerName,
                amount: batches.reduce(Decimal(0)) { $0 + $1.sales },
                units: batches.reduce(0) { $0 + $1.units }
            )
        }
        .sorted {
            if $0.periodStart == $1.periodStart {
                return $0.customerName < $1.customerName
            }
            return $0.periodStart < $1.periodStart
        }
    }

    var comparisonTitle: String {
        let months = selectedComparisonMonths
        guard let first = months.first else { return "No months selected" }
        guard months.count > 1, let last = months.last else {
            return first.salesLensMonthText
        }
        return "\(first.salesLensMonthText) vs \(last.salesLensMonthText)"
    }

    var comparisonInsight: String? {
        let months = selectedComparisonMonths
        guard months.count == 2,
              let earlierMonth = months.first,
              let laterMonth = months.last else {
            return "Select exactly two months to see the percentage change."
        }

        let earlierSales = salesTotal(for: earlierMonth)
        let laterSales = salesTotal(for: laterMonth)
        guard earlierSales != 0 else {
            return "\(laterMonth.salesLensMonthText) has \(laterSales.currencyText) in sales; \(earlierMonth.salesLensMonthText) had no sales to compare against."
        }

        let earlierNumber = NSDecimalNumber(decimal: earlierSales).doubleValue
        let laterNumber = NSDecimalNumber(decimal: laterSales).doubleValue
        let percentChange = ((laterNumber - earlierNumber) / earlierNumber) * 100
        let direction = percentChange >= 0 ? "up" : "down"
        let percentText = abs(percentChange).percentageText
        let subject = comparisonSubject(for: laterMonth, comparedTo: earlierMonth)

        return "\(subject) was \(direction) \(percentText) from \(earlierMonth.salesLensMonthText)."
    }

    var selectedTopSellerMonth: Date? {
        selectedSalesMonth
    }

    var yearOverYearComparison: MonthComparison? {
        if let cachedYearOverYearComparison {
            return cachedYearOverYearComparison
        }

        guard let selectedSalesMonth,
              let priorYearMonth = Calendar.reporting.date(byAdding: .year, value: -1, to: selectedSalesMonth) else {
            cachedYearOverYearComparison = .some(nil)
            return nil
        }

        if period == .monthly && priorYearMatch(for: selectedSalesMonth) == nil {
            cachedYearOverYearComparison = .some(nil)
            return nil
        }

        let currentBatches = selectedPeriodBatches
        let priorBatches = filteredImportBatches.filter {
            isInSelectedPeriod($0.salesMonth, relativeTo: priorYearMonth)
        }

        guard !currentBatches.isEmpty || !priorBatches.isEmpty else {
            cachedYearOverYearComparison = .some(nil)
            return nil
        }

        let result = MonthComparison(
            currentMonth: selectedSalesMonth,
            priorYearMonth: priorYearMonth,
            currentSales: currentBatches.reduce(Decimal(0)) { $0 + $1.sales },
            priorYearSales: priorBatches.reduce(Decimal(0)) { $0 + $1.sales },
            currentUnits: currentBatches.reduce(0) { $0 + $1.units },
            priorYearUnits: priorBatches.reduce(0) { $0 + $1.units },
            currentTransactions: currentBatches.reduce(0) { $0 + $1.rowCount },
            priorYearTransactions: priorBatches.reduce(0) { $0 + $1.rowCount },
            currentInventoryUnits: inventoryUnits(for: selectedSalesMonth),
            priorYearInventoryUnits: inventoryUnits(for: priorYearMonth)
        )
        cachedYearOverYearComparison = result
        return result
    }

    var topSellers: [TopSeller] {
        if let cachedTopSellers {
            return cachedTopSellers
        }
        guard selectedSalesMonth != nil else { return [] }

        let monthRecords = currentPeriodRecords
        let priorYearRecords = priorYearPeriodRecords
        let priorInventoryByKey = Dictionary(
            grouping: priorYearRecords,
            by: topSellerKey(for:)
        )
        .mapValues { records in
            records.compactMap(\.inventoryUnits).reduce(0, +)
        }
        let currentYearToDateByKey = Dictionary(
            grouping: currentYearToDateRecords(),
            by: topSellerKey(for:)
        )

        let grouped = Dictionary(grouping: monthRecords, by: topSellerKey(for:))

        let result: [TopSeller] = grouped.map { entry in
            let key = entry.key
            let records = entry.value
            let yearToDateRecords = currentYearToDateByKey[key] ?? []
            return TopSeller(
                rank: 0,
                brandName: key.brandName,
                styleNumber: key.styleNumber,
                styleName: key.styleName,
                colorName: key.colorName,
                artCode: key.artCode,
                sales: records.reduce(Decimal(0)) { $0 + $1.amount },
                units: records.compactMap(\.units).reduce(0, +),
                currentYearSales: yearToDateRecords.reduce(Decimal(0)) { $0 + $1.amount },
                currentYearUnits: yearToDateRecords.compactMap(\.units).reduce(0, +),
                rowCount: records.count,
                inventoryUnits: records.compactMap(\.inventoryUnits).reduce(0, +),
                priorYearInventoryUnits: priorInventoryByKey[key]
            )
        }
        .sorted { lhs, rhs in
            if lhs.sales == rhs.sales {
                return lhs.units > rhs.units
            }
            return lhs.sales > rhs.sales
        }
        .prefix(25)
        .enumerated()
        .map { index, seller in
            TopSeller(
                rank: index + 1,
                brandName: seller.brandName,
                styleNumber: seller.styleNumber,
                styleName: seller.styleName,
                colorName: seller.colorName,
                artCode: seller.artCode,
                sales: seller.sales,
                units: seller.units,
                currentYearSales: seller.currentYearSales,
                currentYearUnits: seller.currentYearUnits,
                rowCount: seller.rowCount,
                inventoryUnits: seller.inventoryUnits,
                priorYearInventoryUnits: seller.priorYearInventoryUnits
            )
        }
        cachedTopSellers = result
        return result
    }

    var topStyles: [TopStyle] {
        if let cachedTopStyles {
            return cachedTopStyles
        }
        guard selectedSalesMonth != nil else { return [] }

        let result = topStyles(from: currentPeriodStyleSummaries)
        cachedTopStyles = result
        return result
    }

    var topStylesByUnits: [TopStyle] {
        if let cachedTopStylesByUnits {
            return cachedTopStylesByUnits
        }
        guard selectedSalesMonth != nil else { return [] }

        let summaries = currentPeriodStyleSummaries
            .sorted {
                if $0.units == $1.units {
                    return $0.sales > $1.sales
                }
                return $0.units > $1.units
            }
        let result = topStyles(from: summaries)
        cachedTopStylesByUnits = result
        return result
    }

    var monthlyStylesByUnits: [TopStyle] {
        if let cachedMonthlyStylesByUnits {
            return cachedMonthlyStylesByUnits
        }
        guard selectedSalesMonth != nil else { return [] }

        let summaries = currentPeriodStyleSummaries
            .sorted {
                if $0.units == $1.units {
                    return $0.sales > $1.sales
                }
                return $0.units > $1.units
            }

        let result = summaries
            .enumerated()
            .map { index, style in
                TopStyle(
                    rank: index + 1,
                    brandName: style.key.brandName,
                    styleNumber: style.key.styleNumber,
                    styleName: style.styleName,
                    sales: style.sales,
                    units: style.units,
                    rowCount: style.rowCount,
                    inventoryUnits: style.inventoryUnits,
                    colorCount: style.colorCount,
                    artCount: style.artCount,
                    artCodes: style.artCodes,
                    artDetails: style.artDetails
                )
            }
        cachedMonthlyStylesByUnits = result
        return result
    }

    private func topStyles(from summaries: [StyleSummary]) -> [TopStyle] {
        summaries
        .prefix(10)
        .enumerated()
        .map { index, style in
            TopStyle(
                rank: index + 1,
                brandName: style.key.brandName,
                styleNumber: style.key.styleNumber,
                styleName: style.styleName,
                sales: style.sales,
                units: style.units,
                rowCount: style.rowCount,
                inventoryUnits: style.inventoryUnits,
                colorCount: style.colorCount,
                artCount: style.artCount,
                artCodes: style.artCodes,
                artDetails: style.artDetails
            )
        }
    }

    var topStyleMonthComparisons: [TopStyleMonthComparison] {
        if let cachedTopStyleMonthComparisons {
            return cachedTopStyleMonthComparisons
        }
        guard selectedSalesMonth != nil else { return [] }

        let priorRecords = priorYearPeriodRecords
        let priorByStyle = Dictionary(grouping: priorRecords, by: topStyleKey(for:))

        let result = currentPeriodStyleSummaries
            .prefix(10)
            .enumerated()
            .map { index, summary in
                let priorMatches = priorByStyle[summary.key] ?? []
                let priorSummary = styleSummaries(from: priorMatches).first
                return TopStyleMonthComparison(
                    rank: index + 1,
                    brandName: summary.key.brandName,
                    styleNumber: summary.key.styleNumber,
                    styleName: summary.styleName,
                    currentUnits: summary.units,
                    priorYearUnits: priorMatches.compactMap(\.units).reduce(0, +),
                    currentSales: summary.sales,
                    priorYearSales: priorMatches.reduce(Decimal(0)) { $0 + $1.amount },
                    colorCount: summary.colorCount,
                    artCount: summary.artCount,
                    artCodes: summary.artCodes,
                    priorYearColorCount: priorSummary?.colorCount ?? 0,
                    priorYearArtCount: priorSummary?.artCount ?? 0,
                    priorYearArtCodes: priorSummary?.artCodes ?? "-"
                )
            }
        cachedTopStyleMonthComparisons = result
        return result
    }

    var styleSignalGroups: [StyleSignalGroup] {
        if let cachedStyleSignalGroups {
            return cachedStyleSignalGroups
        }

        guard selectedSalesMonth != nil else { return [] }
        let priorSummaries = styleSummaries(from: priorYearPeriodRecords)
        guard !priorSummaries.isEmpty else { return [] }

        let currentByStyle = Dictionary(uniqueKeysWithValues: currentPeriodStyleSummaries.map { ($0.key, $0) })
        let priorByStyle = Dictionary(uniqueKeysWithValues: priorSummaries.map { ($0.key, $0) })
        let allKeys = Set(currentByStyle.keys).union(priorByStyle.keys)

        let items = allKeys.map { key in
            let current = currentByStyle[key]
            let prior = priorByStyle[key]
            return StyleSignalItem(
                rank: 0,
                brandName: key.brandName,
                styleNumber: key.styleNumber,
                styleName: current?.styleName ?? prior?.styleName ?? "Unknown Style Name",
                currentSales: current?.sales ?? Decimal(0),
                priorYearSales: prior?.sales ?? Decimal(0),
                currentUnits: current?.units ?? 0,
                priorYearUnits: prior?.units ?? 0,
                colorCount: current?.colorCount ?? 0,
                priorYearColorCount: prior?.colorCount ?? 0,
                artCount: current?.artCount ?? 0,
                priorYearArtCount: prior?.artCount ?? 0
            )
        }

        let groups: [StyleSignalGroup] = StyleSignalKind.allCases.compactMap { kind in
            let ranked = rankedSignalItems(for: kind, from: items)
            guard !ranked.isEmpty else { return nil }
            return StyleSignalGroup(kind: kind, items: ranked)
        }

        cachedStyleSignalGroups = groups
        return groups
    }

    private func rankedSignalItems(for kind: StyleSignalKind, from items: [StyleSignalItem]) -> [StyleSignalItem] {
        let filtered: [StyleSignalItem]
        let sorted: [StyleSignalItem]

        switch kind {
        case .growthDrivers:
            filtered = items.filter { $0.salesChange > 0 }
            sorted = filtered.sorted {
                if $0.salesChange == $1.salesChange { return $0.unitChange > $1.unitChange }
                return $0.salesChange > $1.salesChange
            }
        case .decliners:
            filtered = items.filter { $0.salesChange < 0 && $0.currentSales > 0 }
            sorted = filtered.sorted {
                if $0.salesChange == $1.salesChange { return $0.unitChange < $1.unitChange }
                return $0.salesChange < $1.salesChange
            }
        case .assortmentExpansion:
            filtered = items.filter { $0.colorCount > $0.priorYearColorCount || $0.artCount > $0.priorYearArtCount }
            sorted = filtered.sorted {
                if $0.assortmentChange == $1.assortmentChange { return $0.salesChange > $1.salesChange }
                return $0.assortmentChange > $1.assortmentChange
            }
        case .assortmentContraction:
            filtered = items.filter { ($0.colorCount < $0.priorYearColorCount || $0.artCount < $0.priorYearArtCount) && $0.currentSales > 0 }
            sorted = filtered.sorted {
                if $0.assortmentChange == $1.assortmentChange { return $0.salesChange < $1.salesChange }
                return $0.assortmentChange < $1.assortmentChange
            }
        case .efficientWinners:
            filtered = items.filter {
                $0.salesChange > 0
                    && $0.colorCount <= $0.priorYearColorCount
                    && $0.artCount <= $0.priorYearArtCount
            }
            sorted = filtered.sorted {
                if $0.salesChange == $1.salesChange { return $0.unitChange > $1.unitChange }
                return $0.salesChange > $1.salesChange
            }
        case .missingLastYearSellers:
            filtered = items.filter { $0.currentSales == 0 && $0.priorYearSales > 0 }
            sorted = filtered.sorted {
                if $0.priorYearSales == $1.priorYearSales { return $0.priorYearUnits > $1.priorYearUnits }
                return $0.priorYearSales > $1.priorYearSales
            }
        }

        return sorted.prefix(5).enumerated().map { index, item in
            StyleSignalItem(
                rank: index + 1,
                brandName: item.brandName,
                styleNumber: item.styleNumber,
                styleName: item.styleName,
                currentSales: item.currentSales,
                priorYearSales: item.priorYearSales,
                currentUnits: item.currentUnits,
                priorYearUnits: item.priorYearUnits,
                colorCount: item.colorCount,
                priorYearColorCount: item.priorYearColorCount,
                artCount: item.artCount,
                priorYearArtCount: item.priorYearArtCount
            )
        }
    }

    func isComparisonMonthSelected(_ month: Date) -> Bool {
        selectedComparisonMonthKeys.contains(monthKey(for: month))
    }

    func toggleComparisonMonth(_ month: Date) {
        let key = monthKey(for: month)
        if selectedComparisonMonthKeys.contains(key) {
            selectedComparisonMonthKeys.remove(key)
        } else {
            selectedComparisonMonthKeys.insert(key)
        }
    }

    func clearComparisonMonths() {
        selectedComparisonMonthKeys.removeAll()
    }

    func selectLatestComparisonMonths(count: Int = 2) {
        selectedComparisonMonthKeys = Set(availableSalesMonths.prefix(count).map(monthKey(for:)))
    }

    func selectLatestMonthWithPriorYear() {
        selectedComparisonMonthKeys = Set(defaultComparisonMonths.map(monthKey(for:)))
    }

    func selectTopSellerMonth(_ month: Date) {
        selectedTopSellerMonthKey = monthKey(for: month)
    }

    func selectBrandFilter(_ brandName: String?) {
        selectedBrandName = normalizedBrandName(brandName)
    }

    func addAccount(named rawName: String) {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        if !accountNames.contains(name) {
            accountNames.append(name)
            accountNames.sort()
            saveAccounts()
        }
        selectedCustomer = name
    }

    func importPOSFile(from url: URL, accountName: String) {
        do {
            let parsed = try POSCSVImporter.parse(url: url)
            addAccount(named: accountName)
            let account = accountName.trimmingCharacters(in: .whitespacesAndNewlines)
            let displayFileName = url.lastPathComponent
            let parsedRecords = parsed.records.map { record in
                var adjustedRecord = record
                adjustedRecord.customerName = account
                return adjustedRecord
            }
            let salesMonth = parsedRecords.first.map { Calendar.reporting.monthStart(for: $0.date) }
            let receivedDate = parsedRecords.compactMap(\.receivedDate).min()
            let importPlan = deduplicatedRecordsForImport(parsedRecords, accountName: account)
            let skippedCount = parsed.skippedCount + importPlan.duplicateCount

            guard !parsedRecords.isEmpty else {
                importSummary = ImportSummary(
                    fileName: displayFileName,
                    importedCount: 0,
                    skippedCount: parsed.skippedCount,
                    salesMonth: salesMonth,
                    receivedDate: receivedDate,
                    status: .warning,
                    message: "No product rows were imported. Keep the file for audit, but there was no monthly sales data to add."
                )
                importError = nil
                return
            }

            guard !importPlan.records.isEmpty else {
                importSummary = ImportSummary(
                    fileName: displayFileName,
                    importedCount: 0,
                    skippedCount: skippedCount,
                    salesMonth: salesMonth,
                    receivedDate: receivedDate,
                    status: .duplicate,
                    message: "Every Rebel Rags transaction row in this upload already exists, so no duplicate sales were added."
                )
                importError = nil
                return
            }

            if isDuplicateImport(records: importPlan.records, sourceFile: displayFileName) {
                importSummary = ImportSummary(
                    fileName: displayFileName,
                    importedCount: 0,
                    skippedCount: skippedCount + importPlan.records.count,
                    salesMonth: salesMonth,
                    receivedDate: receivedDate,
                    status: .duplicate,
                    message: "This monthly file appears to already be imported, so no duplicate rows were added."
                )
                importError = nil
                return
            }

            records = (records + importPlan.records).sorted { $0.date > $1.date }
            let duplicateMessage = importPlan.duplicateCount > 0
                ? " Skipped \(importPlan.duplicateCount) Rebel Rags transaction rows that were already imported."
                : ""
            importSummary = ImportSummary(
                fileName: displayFileName,
                importedCount: importPlan.records.count,
                skippedCount: skippedCount,
                salesMonth: salesMonth,
                receivedDate: receivedDate,
                status: .imported,
                message: "Added \(importPlan.records.count) product rows to \(account).\(duplicateMessage)"
            )
            importError = nil
            save()
        } catch {
            importError = error.localizedDescription
        }
    }

    func deleteRecords(at offsets: IndexSet) {
        let ids = offsets.map { filteredRecords[$0].id }
        records.removeAll { ids.contains($0.id) }
        save()
    }

    func deleteImportBatches(ids: Set<String>) {
        guard !ids.isEmpty else { return }
        records.removeAll { record in
            ids.contains(importBatchID(for: record))
        }
        save()
    }

    func clearAll() {
        records.removeAll()
        accountNames = ["Volshop"]
        selectedCustomer = "Volshop"
        selectedBrandName = nil
        importSummary = nil
        importError = nil
        save()
        saveAccounts()
    }

    private func load() {
        do {
            if FileManager.default.fileExists(atPath: accountsURL.path) {
                let accountData = try Data(contentsOf: accountsURL)
                accountNames = try JSONDecoder.salesLens.decode([String].self, from: accountData)
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                if accountNames.isEmpty {
                    accountNames = ["Volshop"]
                }
            }

            guard FileManager.default.fileExists(atPath: persistenceURL.path) else {
                if selectedCustomer == nil {
                    selectedCustomer = accountNames.first
                }
                return
            }
            let data = try Data(contentsOf: persistenceURL)
            records = try JSONDecoder.salesLens.decode([SalesRecord].self, from: data)
            repairPersistedReportDates()
            let mergedAccounts = Array(Set(accountNames + records.map(\.customerName))).sorted()
            if mergedAccounts != accountNames {
                accountNames = mergedAccounts
                saveAccounts()
            }
            if selectedCustomer == nil {
                selectedCustomer = accountNames.first
            }
        } catch {
            importError = "Could not load saved sales data: \(error.localizedDescription)"
        }
    }

    private func save() {
        do {
            try FileManager.default.createDirectory(
                at: persistenceURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder.salesLens.encode(records)
            try data.write(to: persistenceURL, options: .atomic)
        } catch {
            importError = "Could not save sales data: \(error.localizedDescription)"
        }
    }

    private func saveAccounts() {
        do {
            try FileManager.default.createDirectory(
                at: accountsURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder.salesLens.encode(accountNames)
            try data.write(to: accountsURL, options: .atomic)
        } catch {
            importError = "Could not save accounts: \(error.localizedDescription)"
        }
    }

    private func isDuplicateImport(records newRecords: [SalesRecord], sourceFile: String) -> Bool {
        guard let first = newRecords.first else { return false }
        let salesMonth = Calendar.reporting.monthStart(for: first.date)
        let customerName = first.customerName

        let existingSourceRecords = records.filter {
            $0.customerName == customerName && $0.sourceFile == sourceFile
        }
        if !existingSourceRecords.isEmpty,
           importSignature(for: existingSourceRecords) == importSignature(for: newRecords) {
            return true
        }

        let newTotals = totals(for: newRecords)
        return importBatches.contains { batch in
            batch.customerName == customerName
                && batch.salesMonth == salesMonth
                && batch.rowCount == newRecords.count
                && batch.units == newTotals.units
                && batch.sales == newTotals.sales
        }
    }

    private func deduplicatedRecordsForImport(
        _ newRecords: [SalesRecord],
        accountName: String
    ) -> (records: [SalesRecord], duplicateCount: Int) {
        guard accountName.caseInsensitiveCompare("Rebel Rags") == .orderedSame else {
            return (newRecords, 0)
        }

        let existingKeys = Set(records
            .filter(isRebelRagsRecord)
            .map(rebelRagsTransactionKey))
        let importableRecords = newRecords.filter { record in
            !existingKeys.contains(rebelRagsTransactionKey(for: record))
        }

        return (importableRecords, newRecords.count - importableRecords.count)
    }

    private func importSignature(for records: [SalesRecord]) -> String {
        let dateRange = records.reduce(into: (min: Date?.none, max: Date?.none)) { range, record in
            if range.min == nil || record.date < range.min! {
                range.min = record.date
            }
            if range.max == nil || record.date > range.max! {
                range.max = record.date
            }
        }
        let totals = totals(for: records)
        return [
            "\(records.count)",
            "\(totals.units)",
            NSDecimalNumber(decimal: totals.sales).stringValue,
            dateRange.min.map(monthDayKey) ?? "",
            dateRange.max.map(monthDayKey) ?? ""
        ].joined(separator: "|")
    }

    private func rebelRagsTransactionKey(for record: SalesRecord) -> String {
        [
            record.customerName.lowercased(),
            "\(record.date.timeIntervalSince1970)",
            record.rawStyleIdentifier ?? "",
            record.styleNumber ?? "",
            record.artCode ?? "",
            record.color ?? "",
            record.size ?? "",
            record.units.map(String.init) ?? "",
            NSDecimalNumber(decimal: record.amount).stringValue
        ].joined(separator: "|")
    }

    private func totals(for records: [SalesRecord]) -> (sales: Decimal, units: Int) {
        (
            records.reduce(Decimal(0)) { $0 + $1.amount },
            records.compactMap(\.units).reduce(0, +)
        )
    }

    private func canonicalImportBatches(from records: [SalesRecord]) -> [ImportBatch] {
        let grouped = Dictionary(grouping: importBatches(from: records)) { batch in
            CanonicalBatchKey(customerName: batch.customerName, salesMonth: batch.salesMonth)
        }

        return grouped.compactMap { _, batches in
            batches.sorted {
                if $0.rowCount == $1.rowCount {
                    return $0.sourceFile < $1.sourceFile
                }
                return $0.rowCount > $1.rowCount
            }
            .first
        }
    }

    private func normalizedBrandName(_ value: String?) -> String? {
        guard let value else { return nil }
        let cleaned = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
        guard !cleaned.isEmpty else { return nil }
        if cleaned.contains("GEAR") || cleaned.contains("COMFORT") || cleaned.contains("C WASH") || cleaned.contains("CWASH") {
            return "GEAR"
        }
        return cleaned
    }

    func displayBrandName(for record: SalesRecord) -> String {
        if let explicitBrand = normalizedBrandName(record.productClass),
           explicitBrand == "CHAMPION" || explicitBrand == "GEAR" {
            return explicitBrand
        }

        if isGearStyle(record) {
            return "GEAR"
        }
        return "CHAMPION"
    }

    private func matchesBrandFilter(record: SalesRecord, selectedBrand: String) -> Bool {
        displayBrandName(for: record) == selectedBrand
    }

    private func isGearStyle(_ record: SalesRecord) -> Bool {
        let styleNumber = normalizedStyleNumber(for: record).uppercased()
        if ProductCatalog.comfortWashStyleNumbers.contains(styleNumber) {
            return true
        }
        if styleNumber.hasPrefix("GDH") {
            return true
        }
        if styleNumber.range(of: #"^G\d"#, options: .regularExpression) != nil {
            return true
        }

        let styleText = [
            record.masterStyle,
            record.rawStyleIdentifier,
            record.productClass
        ]
            .compactMap { $0?.uppercased() }
            .joined(separator: " ")
        return styleText.contains("GEAR") || styleText.contains("COMFORT WASH")
    }

    func brandDisplayName(_ brandName: String) -> String {
        switch brandName.uppercased() {
        case "CHAMPION":
            return "Champion"
        case "GEAR":
            return "Gear"
        default:
            return brandName
                .lowercased()
                .split(separator: " ")
                .map { $0.prefix(1).uppercased() + $0.dropFirst() }
                .joined(separator: " ")
        }
    }

    private func repairPersistedReportDates() {
        var didRepair = false

        let originalCount = records.count
        records.removeAll { record in
            record.customerName == "Rebel Rags"
                && record.rawStyleIdentifier == nil
                && record.styleNumber == nil
                && record.masterStyle == nil
        }
        if records.count != originalCount {
            didRepair = true
        }

        let duplicateBatchIDs = duplicateImportBatchIDsToRemove()
        if !duplicateBatchIDs.isEmpty {
            records.removeAll { record in
                duplicateBatchIDs.contains(importBatchID(for: record))
            }
            didRepair = true
        }

        records = records.map { record in
            var repairedRecord = record
            if repairedRecord.customerName == "HanesBrands" {
                repairedRecord.customerName = "Volshop"
                didRepair = true
            }

            if let normalizedBrand = normalizedBrandName(repairedRecord.productClass),
               normalizedBrand != (repairedRecord.productClass ?? "") {
                repairedRecord.productClass = normalizedBrand
                didRepair = true
            }

            if let styleNumber = repairedRecord.styleNumber {
                let trimmedStyleNumber = styleNumber.trimmingCharacters(in: CharacterSet(charactersIn: "- "))
                if trimmedStyleNumber != styleNumber {
                    repairedRecord.styleNumber = trimmedStyleNumber.isEmpty ? nil : trimmedStyleNumber
                    didRepair = true
                }
            }

            if isRebelRagsRecord(repairedRecord),
               let transactionDate = repairedRecord.lastReceived,
               repairedRecord.date != transactionDate {
                repairedRecord.date = transactionDate
                didRepair = true
            }

            if isRebelRagsRecord(repairedRecord),
               let rawStyleIdentifier = repairedRecord.rawStyleIdentifier {
                let parsedIdentifier = rebelRagsIdentifier(from: rawStyleIdentifier)
                if let parsedStyleNumber = parsedIdentifier.styleNumber,
                   parsedStyleNumber != repairedRecord.styleNumber {
                    repairedRecord.styleNumber = parsedStyleNumber
                    didRepair = true
                }
                if let parsedArtCode = parsedIdentifier.artCode,
                   parsedArtCode != repairedRecord.artCode {
                    repairedRecord.artCode = parsedArtCode
                    didRepair = true
                }
            } else if let rawStyleIdentifier = repairedRecord.rawStyleIdentifier {
                let parsedIdentifier = StyleIdentifierParser.parse(rawStyleIdentifier)
                if let parsedStyleNumber = parsedIdentifier.styleNumber,
                   parsedStyleNumber != repairedRecord.styleNumber {
                    repairedRecord.styleNumber = parsedStyleNumber
                    didRepair = true
                }
                if let parsedColorCode = parsedIdentifier.colorCode,
                   parsedColorCode != repairedRecord.colorCode {
                    repairedRecord.colorCode = parsedColorCode
                    repairedRecord.catalogColorName = ProductCatalog.colorNamesByCode[parsedColorCode] ?? repairedRecord.catalogColorName
                    didRepair = true
                }
                if let parsedArtCode = parsedIdentifier.artCode,
                   parsedArtCode != repairedRecord.artCode {
                    repairedRecord.artCode = parsedArtCode
                    didRepair = true
                }
            }

            if needsCenturyRepair(repairedRecord.date),
               let receivedDate = POSCSVImporter.reportDate(from: repairedRecord.sourceFile),
               let salesDate = POSCSVImporter.salesPeriodDate(from: receivedDate) {
                repairedRecord.date = salesDate
                repairedRecord.receivedDate = receivedDate
                didRepair = true
            } else if repairedRecord.receivedDate == nil,
                      !isRebelRagsRecord(repairedRecord),
                      let salesDate = POSCSVImporter.salesPeriodDate(fromFileName: repairedRecord.sourceFile),
                      Calendar.reporting.monthStart(for: repairedRecord.date) != Calendar.reporting.monthStart(for: salesDate) {
                repairedRecord.date = salesDate
                didRepair = true
            } else if let receivedDate = repairedRecord.receivedDate,
                      needsCenturyRepair(receivedDate),
                      let correctedReceivedDate = POSCSVImporter.reportDate(from: repairedRecord.sourceFile) {
                repairedRecord.receivedDate = correctedReceivedDate
                didRepair = true
            }

            return repairedRecord
        }

        if didRepair {
            records = records.sorted { $0.date > $1.date }
            save()
        }
    }

    private func needsCenturyRepair(_ date: Date) -> Bool {
        Calendar.reporting.component(.year, from: date) < 2000
    }

    private func isRebelRagsRecord(_ record: SalesRecord) -> Bool {
        record.customerName.caseInsensitiveCompare("Rebel Rags") == .orderedSame
    }

    private func rebelRagsIdentifier(from rawValue: String) -> (styleNumber: String?, artCode: String?) {
        let tokens = rawValue
            .uppercased()
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init)

        let styleNumber = tokens.last { token in
            token.contains(where: \.isLetter)
                && token.contains(where: \.isNumber)
                && token.count >= 4
                && !isRebelRagsArtCodeToken(token)
        }
        let artCode = tokens.first { token in
            guard token != styleNumber else { return false }
            return isRebelRagsArtCodeToken(token)
        }

        return (styleNumber, artCode)
    }

    private func isRebelRagsArtCodeToken(_ token: String) -> Bool {
        if token.range(of: #"^(APC|APO|AEC|AE|AP)[A-Z0-9]+$"#, options: .regularExpression) != nil {
            return true
        }
        return token.count >= 6 && token.allSatisfy(\.isNumber)
    }

    private func duplicateImportBatchIDsToRemove() -> Set<String> {
        let grouped = Dictionary(grouping: importBatches(from: records), by: duplicateImportKey(for:))
        return grouped.values.reduce(into: Set<String>()) { ids, batches in
            guard batches.count > 1 else { return }
            let keepBatch = preferredBatchToKeep(from: batches)
            batches
                .filter { $0.id != keepBatch.id }
                .forEach { ids.insert($0.id) }
        }
    }

    private func duplicateImportKey(for batch: ImportBatch) -> String {
        [
            batch.customerName,
            monthKey(for: batch.salesMonth),
            "\(batch.rowCount)",
            "\(batch.units)",
            NSDecimalNumber(decimal: batch.sales).stringValue
        ].joined(separator: "|")
    }

    private func preferredBatchToKeep(from batches: [ImportBatch]) -> ImportBatch {
        batches.sorted { lhs, rhs in
            let lhsScore = batchPreferenceScore(lhs)
            let rhsScore = batchPreferenceScore(rhs)
            if lhsScore == rhsScore {
                return lhs.sourceFile < rhs.sourceFile
            }
            return lhsScore > rhsScore
        }
        .first ?? batches[0]
    }

    private func batchPreferenceScore(_ batch: ImportBatch) -> Int {
        var score = 0
        if POSCSVImporter.reportDate(from: batch.sourceFile) != nil {
            score += 10
        }
        if batch.sourceFile.localizedCaseInsensitiveContains("data") {
            score -= 1
        }
        return score
    }

    private var defaultComparisonMonths: [Date] {
        guard let latestMonth = availableSalesMonths.first else { return [] }
        if let priorYearMonth = priorYearMatch(for: latestMonth) {
            return [latestMonth, priorYearMonth]
        }
        return Array(availableSalesMonths.prefix(2))
    }

    private func priorYearMatch(for month: Date) -> Date? {
        guard let priorYear = Calendar.reporting.date(byAdding: .year, value: -1, to: month) else {
            return nil
        }

        let priorYearKey = monthKey(for: priorYear)
        return availableSalesMonths.first {
            monthKey(for: $0) == priorYearKey
        }
    }

    private func salesTotal(for month: Date) -> Decimal {
        let key = monthKey(for: month)
        return filteredImportBatches
            .filter { monthKey(for: $0.salesMonth) == key }
            .reduce(Decimal(0)) { $0 + $1.sales }
    }

    private func salesTotal(year: Int, month: Int) -> Decimal {
        filteredImportBatches
            .filter { batch in
                let components = Calendar.reporting.dateComponents([.year, .month], from: batch.salesMonth)
                return components.year == year && components.month == month
            }
            .reduce(Decimal(0)) { $0 + $1.sales }
    }

    private func monthName(for monthNumber: Int) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.shortMonthSymbols[max(0, min(monthNumber - 1, 11))]
    }

    private func inventoryUnits(for month: Date) -> Int {
        canonicalRecords(for: month)
            .compactMap(\.inventoryUnits)
            .reduce(0, +)
    }

    private var currentPeriodRecords: [SalesRecord] {
        if let cachedCurrentPeriodRecords {
            return cachedCurrentPeriodRecords
        }
        guard let selectedSalesMonth else { return [] }
        let result = canonicalRecords(inSelectedPeriodRelativeTo: selectedSalesMonth)
        cachedCurrentPeriodRecords = result
        return result
    }

    private var priorYearPeriodRecords: [SalesRecord] {
        if let cachedPriorYearPeriodRecords {
            return cachedPriorYearPeriodRecords
        }
        guard let selectedSalesMonth,
              let priorYearMonth = Calendar.reporting.date(byAdding: .year, value: -1, to: selectedSalesMonth) else {
            return []
        }

        if period == .monthly && priorYearMatch(for: selectedSalesMonth) == nil {
            return []
        }

        let result = canonicalRecords(inSelectedPeriodRelativeTo: priorYearMonth)
        cachedPriorYearPeriodRecords = result
        return result
    }

    private func canonicalRecords(inSelectedPeriodRelativeTo referenceMonth: Date) -> [SalesRecord] {
        let canonicalBatchKeys = Set(
            filteredImportBatches
                .filter { isInSelectedPeriod($0.salesMonth, relativeTo: referenceMonth) }
                .map { importBatchKey(customerName: $0.customerName, sourceFile: $0.sourceFile, salesMonth: $0.salesMonth) }
        )

        return filteredRecords.filter { record in
            canonicalBatchKeys.contains(
                importBatchKey(customerName: record.customerName, sourceFile: record.sourceFile, salesMonth: record.date)
            )
        }
    }

    private func currentYearToDateRecords() -> [SalesRecord] {
        guard let selectedSalesMonth else { return [] }
        let referenceComponents = Calendar.reporting.dateComponents([.year, .month], from: selectedSalesMonth)
        guard let referenceYear = referenceComponents.year,
              let referenceMonth = referenceComponents.month else {
            return []
        }

        let canonicalBatchKeys = Set(
            filteredImportBatches
                .filter { batch in
                    let components = Calendar.reporting.dateComponents([.year, .month], from: batch.salesMonth)
                    return components.year == referenceYear
                        && (components.month ?? 0) <= referenceMonth
                }
                .map { importBatchKey(customerName: $0.customerName, sourceFile: $0.sourceFile, salesMonth: $0.salesMonth) }
        )

        return filteredRecords.filter { record in
            canonicalBatchKeys.contains(
                importBatchKey(customerName: record.customerName, sourceFile: record.sourceFile, salesMonth: record.date)
            )
        }
    }

    private func isInSelectedPeriod(_ date: Date, relativeTo referenceMonth: Date) -> Bool {
        switch period {
        case .monthly:
            return monthKey(for: date) == monthKey(for: referenceMonth)
        case .yearly:
            let dateComponents = Calendar.reporting.dateComponents([.year, .month], from: date)
            let referenceComponents = Calendar.reporting.dateComponents([.year, .month], from: referenceMonth)
            guard let dateYear = dateComponents.year,
                  let dateMonth = dateComponents.month,
                  let referenceYear = referenceComponents.year,
                  let referenceMonthNumber = referenceComponents.month else {
                return false
            }

            return dateYear == referenceYear && dateMonth <= referenceMonthNumber
        }
    }

    private func yearToDateTitle(for month: Date) -> String {
        let components = Calendar.reporting.dateComponents([.year], from: month)
        let year = components.year ?? 0
        return "\(year) Jan-\(month.salesLensShortMonthText)"
    }

    private func canonicalRecords(for month: Date) -> [SalesRecord] {
        let selectedMonthKey = monthKey(for: month)
        let canonicalBatchKeys = Set(
            filteredImportBatches
                .filter { monthKey(for: $0.salesMonth) == selectedMonthKey }
                .map { importBatchKey(customerName: $0.customerName, sourceFile: $0.sourceFile, salesMonth: $0.salesMonth) }
        )

        return filteredRecords.filter { record in
            canonicalBatchKeys.contains(
                importBatchKey(customerName: record.customerName, sourceFile: record.sourceFile, salesMonth: record.date)
            )
        }
    }

    private func topSellerKey(for record: SalesRecord) -> TopSellerKey {
        TopSellerKey(
            brandName: displayBrandName(for: record),
            styleNumber: normalizedStyleNumber(for: record),
            styleName: record.masterStyle ?? "Unknown Style Name",
            colorName: record.catalogColorName ?? record.color ?? "Unknown Color",
            artCode: record.artCode ?? "-"
        )
    }

    private func topStyleKey(for record: SalesRecord) -> TopStyleKey {
        TopStyleKey(
            brandName: displayBrandName(for: record),
            styleNumber: normalizedStyleNumber(for: record)
        )
    }

    private var currentPeriodStyleSummaries: [StyleSummary] {
        if let cachedStyleSummaries {
            return cachedStyleSummaries
        }

        let result = styleSummaries(from: currentPeriodRecords)
        cachedStyleSummaries = result
        return result
    }

    private func styleSummaries(from records: [SalesRecord]) -> [StyleSummary] {
        let grouped = Dictionary(grouping: records, by: topStyleKey(for:))

        return grouped.map { key, records in
            let styleNames = Dictionary(grouping: records.compactMap(\.masterStyle)) { $0 }
                .map { name, matches in (name: name, count: matches.count) }
                .sorted {
                    if $0.count == $1.count {
                        return $0.name < $1.name
                    }
                    return $0.count > $1.count
                }

            let artCodes = Set(records.compactMap(\.artCode))
                .sorted()
            let artDetails = artDetails(from: records, artCodes: artCodes)
            return StyleSummary(
                key: key,
                styleName: styleNames.first?.name ?? "Unknown Style Name",
                sales: records.reduce(Decimal(0)) { $0 + $1.amount },
                units: records.compactMap(\.units).reduce(0, +),
                rowCount: records.count,
                inventoryUnits: records.compactMap(\.inventoryUnits).reduce(0, +),
                colorCount: Set(records.compactMap { $0.catalogColorName ?? $0.color }).count,
                artCount: artCodes.count,
                artCodes: artCodes.isEmpty ? "-" : artCodes.joined(separator: ", "),
                artDetails: artDetails
            )
        }
        .sorted {
            if $0.sales == $1.sales {
                return $0.units > $1.units
            }
            return $0.sales > $1.sales
        }
    }

    private func artDetails(from records: [SalesRecord], artCodes: [String]) -> String {
        guard !artCodes.isEmpty else { return "-" }

        let recordsByArtCode = Dictionary(grouping: records) { record in
            record.artCode ?? "-"
        }

        return artCodes.map { artCode in
            guard let recordsForArt = recordsByArtCode[artCode],
                  let description = commonDescription(from: recordsForArt) else {
                return artCode
            }

            return "\(artCode) - \(description)"
        }
        .joined(separator: ", ")
    }

    private func commonDescription(from records: [SalesRecord]) -> String? {
        Dictionary(grouping: records.compactMap(\.masterStyle)) { $0 }
            .map { description, matches in (description: description, count: matches.count) }
            .sorted {
                if $0.count == $1.count {
                    return $0.description < $1.description
                }
                return $0.count > $1.count
            }
            .first?
            .description
    }

    private func normalizedStyleNumber(for record: SalesRecord) -> String {
        normalizedStyleBucket(from: record.styleNumber)
            ?? normalizedStyleBucket(from: record.rawStyleIdentifier)
            ?? "Unknown Style"
    }

    private func normalizedStyleBucket(from value: String?) -> String? {
        guard let value else { return nil }

        let cleaned = value
            .trimmingCharacters(in: CharacterSet(charactersIn: "- "))
            .uppercased()

        guard !cleaned.isEmpty else { return nil }

        if let firstDash = cleaned.firstIndex(of: "-") {
            let firstToken = String(cleaned[..<firstDash])
                .trimmingCharacters(in: CharacterSet(charactersIn: "- "))
            let remainingTokens = cleaned[firstDash...]
                .split(separator: "-")
                .map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: "- ")) }

            if isStyleNumberToken(firstToken),
               remainingTokens.contains(where: isLikelyColorOrArtToken) {
                return firstToken
            }

            if let lastStyleToken = remainingTokens.reversed().first(where: isStyleNumberToken) {
                return lastStyleToken
            }
        }

        if let colorCode = knownColorSuffix(in: cleaned) {
            let styleEnd = cleaned.index(cleaned.endIndex, offsetBy: -colorCode.count)
            let styleCandidate = String(cleaned[..<styleEnd])
                .trimmingCharacters(in: CharacterSet(charactersIn: "- "))
            if isStyleNumberToken(styleCandidate) {
                return styleCandidate
            }
        }

        if isStyleNumberToken(cleaned) {
            return cleaned
        }

        let parsedIdentifier = StyleIdentifierParser.parse(cleaned)
        if let parsedStyleNumber = parsedIdentifier.styleNumber,
           parsedStyleNumber != cleaned,
           isStyleNumberToken(parsedStyleNumber) {
            return parsedStyleNumber
        }

        return cleaned
    }

    private func isStyleNumberToken(_ token: String) -> Bool {
        token.range(of: #"^[A-Z]{1,4}\d{2,5}[A-Z0-9]*$"#, options: .regularExpression) != nil
    }

    private func isLikelyColorOrArtToken(_ token: String) -> Bool {
        ProductCatalog.knownColorCodes.contains(token)
            || token.range(of: #"^\d{3,}$"#, options: .regularExpression) != nil
            || token.range(of: #"^(APC|APO|AEC|AE|AP)\d+"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private func knownColorSuffix(in value: String) -> String? {
        ProductCatalog.knownColorCodes
            .filter { value.hasSuffix($0) && value.count > $0.count }
            .sorted { $0.count > $1.count }
            .first
    }

    private func comparisonSubject(for laterMonth: Date, comparedTo earlierMonth: Date) -> String {
        let laterComponents = Calendar.reporting.dateComponents([.year, .month], from: laterMonth)
        let earlierComponents = Calendar.reporting.dateComponents([.year, .month], from: earlierMonth)
        if laterComponents.month == earlierComponents.month,
           let laterYear = laterComponents.year,
           let earlierYear = earlierComponents.year,
           laterYear - earlierYear == 1 {
            return laterMonth.salesLensMonthOnlyText
        }

        return laterMonth.salesLensMonthText
    }

    private func monthKey(for date: Date) -> String {
        let start = Calendar.reporting.monthStart(for: date)
        let components = Calendar.reporting.dateComponents([.year, .month], from: start)
        return "\(components.year ?? 0)-\(components.month ?? 0)"
    }

    private func monthDayKey(for date: Date) -> String {
        let components = Calendar.reporting.dateComponents([.year, .month, .day], from: date)
        return "\(components.year ?? 0)-\(components.month ?? 0)-\(components.day ?? 0)"
    }

    private func importBatchKey(customerName: String, sourceFile: String, salesMonth: Date) -> String {
        "\(customerName)|\(sourceFile)|\(monthKey(for: salesMonth))"
    }

    private func importBatchID(for record: SalesRecord) -> String {
        let salesMonth = Calendar.reporting.monthStart(for: record.date)
        return "\(record.customerName)-\(record.sourceFile)-\(salesMonth.timeIntervalSince1970)"
    }

    private func invalidateDataCaches() {
        cachedImportBatches = nil
        cachedLatestUploadedDateByCustomer = nil
        invalidateFilterCaches()
    }

    private var latestUploadedDateByCustomer: [String: Date] {
        if let cachedLatestUploadedDateByCustomer {
            return cachedLatestUploadedDateByCustomer
        }

        let result = Dictionary(grouping: records, by: \.customerName)
            .compactMapValues { customerRecords in
                customerRecords.map(\.date).max()
            }
        cachedLatestUploadedDateByCustomer = result
        return result
    }

    private func invalidateFilterCaches() {
        cachedFilteredRecords = nil
        cachedFilteredImportBatches = nil
        cachedAvailableSalesMonths = nil
        invalidatePeriodCaches()
    }

    private func invalidatePeriodCaches() {
        cachedSelectedPeriodBatches = nil
        cachedCurrentPeriodRecords = nil
        cachedPriorYearPeriodRecords = nil
        cachedStyleSummaries = nil
        cachedTopSellers = nil
        cachedTopStyles = nil
        cachedTopStylesByUnits = nil
        cachedMonthlyStylesByUnits = nil
        cachedTopStyleMonthComparisons = nil
        cachedStyleSignalGroups = nil
        cachedSelectedCustomerClassMix = nil
        cachedBestSalesDaySummary = nil
        cachedYearToDateComparison = nil
        cachedYearOverYearComparison = nil
    }
}

private struct BucketKey: Hashable {
    let periodStart: Date
    let customerName: String
}

private struct CanonicalBatchKey: Hashable {
    let customerName: String
    let salesMonth: Date
}

private struct BatchKey: Hashable {
    let customerName: String
    let sourceFile: String
    let salesMonth: Date
}

private struct TopSellerKey: Hashable {
    let brandName: String
    let styleNumber: String
    let styleName: String
    let colorName: String
    let artCode: String
}

private struct TopStyleKey: Hashable {
    let brandName: String
    let styleNumber: String
}

enum SalesLensDataLocation {
    private static let appSupportFolderName = "SalesLens"
    private static let sharedFolderName = "SalesLens Data"

    static var sharedDirectory: URL {
        if let dropboxDirectory {
            return dropboxDirectory.appendingPathComponent(sharedFolderName, isDirectory: true)
        }
        return legacyDirectory
    }

    static var legacyDirectory: URL {
        let supportDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return supportDirectory.appendingPathComponent(appSupportFolderName, isDirectory: true)
    }

    static var productImagesDirectory: URL {
        sharedDirectory.appendingPathComponent("ProductImages", isDirectory: true)
    }

    static var displayPath: String {
        sharedDirectory.path
    }

    static func migrateLegacyDataIfNeeded() {
        let destinationDirectory = sharedDirectory
        let sourceDirectory = legacyDirectory
        guard destinationDirectory.standardizedFileURL != sourceDirectory.standardizedFileURL else { return }

        do {
            try FileManager.default.createDirectory(at: destinationDirectory, withIntermediateDirectories: true)
            copyIfNeeded("sales-records.json", from: sourceDirectory, to: destinationDirectory)
            copyIfNeeded("accounts.json", from: sourceDirectory, to: destinationDirectory)
            copyDirectoryIfNeeded("ProductImages", from: sourceDirectory, to: destinationDirectory)
        } catch {
            // If Dropbox is unavailable for any reason, save/load calls will surface the specific failure.
        }
    }

    private static var dropboxDirectory: URL? {
        let homeDirectory = FileManager.default.homeDirectoryForCurrentUser
        let candidates = [
            homeDirectory.appendingPathComponent("Dropbox", isDirectory: true),
            homeDirectory
                .appendingPathComponent("Library", isDirectory: true)
                .appendingPathComponent("CloudStorage", isDirectory: true)
                .appendingPathComponent("Dropbox", isDirectory: true)
        ]

        return candidates.first { url in
            var isDirectory: ObjCBool = false
            return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
        }
    }

    private static func copyIfNeeded(_ fileName: String, from sourceDirectory: URL, to destinationDirectory: URL) {
        let sourceURL = sourceDirectory.appendingPathComponent(fileName)
        let destinationURL = destinationDirectory.appendingPathComponent(fileName)
        guard FileManager.default.fileExists(atPath: sourceURL.path),
              !FileManager.default.fileExists(atPath: destinationURL.path) else {
            return
        }

        try? FileManager.default.copyItem(at: sourceURL, to: destinationURL)
    }

    private static func copyDirectoryIfNeeded(_ directoryName: String, from sourceDirectory: URL, to destinationDirectory: URL) {
        let sourceURL = sourceDirectory.appendingPathComponent(directoryName, isDirectory: true)
        let destinationURL = destinationDirectory.appendingPathComponent(directoryName, isDirectory: true)
        guard FileManager.default.fileExists(atPath: sourceURL.path),
              !FileManager.default.fileExists(atPath: destinationURL.path) else {
            return
        }

        try? FileManager.default.copyItem(at: sourceURL, to: destinationURL)
    }
}

private struct StyleSummary {
    let key: TopStyleKey
    let styleName: String
    let sales: Decimal
    let units: Int
    let rowCount: Int
    let inventoryUnits: Int
    let colorCount: Int
    let artCount: Int
    let artCodes: String
    let artDetails: String
}

private extension JSONEncoder {
    static var salesLens: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}

private extension JSONDecoder {
    static var salesLens: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private extension Double {
    var percentageText: String {
        DisplayFormatters.percent.string(from: NSNumber(value: self / 100)) ?? "\(self)%"
    }
}

private extension Decimal {
    var currencyText: String {
        DisplayFormatters.currency.string(from: NSDecimalNumber(decimal: self)) ?? "$0.00"
    }
}
