import Charts
import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var store: SalesStore

    var body: some View {
        VStack(spacing: 0) {
            HeaderView()

            if store.records.isEmpty {
                EmptyStateView()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        BrandFilterView()
                        if store.filteredRecords.isEmpty {
                            FilterEmptyStateView()
                        } else {
                            YearToDateTrackerView()
                            CustomerClassMixView()
                            SalesSnapshotView()
                            StyleSignalsView()
                            TopFiveStyleComparisonView()
                            TopSellersView()
                            TopStylesView()
                        }
                    }
                    .padding(24)
                }
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

private struct FilterEmptyStateView: View {
    @EnvironmentObject private var store: SalesStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("No Results for Current Filters", systemImage: "line.3.horizontal.decrease.circle")
                .font(.headline)

            Text(store.filterEmptyMessage ?? "No records match the current filters.")
                .font(.callout)
                .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                Button {
                    store.selectedCustomer = nil
                } label: {
                    Label("Show All Customers", systemImage: "person.3")
                }

                Button {
                    store.selectBrandFilter(nil)
                } label: {
                    Label("Clear Brand/Class", systemImage: "xmark.circle")
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct BrandFilterView: View {
    @EnvironmentObject private var store: SalesStore

    var body: some View {
        HStack(spacing: 12) {
            Label("Brand/Class", systemImage: "tag")
                .font(.headline)

            Menu {
                Button {
                    store.selectBrandFilter(nil)
                } label: {
                    Label("All", systemImage: store.selectedBrandName == nil ? "checkmark.circle.fill" : "circle")
                }

                Divider()

                ForEach(store.availableBrandNames, id: \.self) { brandName in
                    Button {
                        store.selectBrandFilter(brandName)
                    } label: {
                        Label(
                            store.brandDisplayName(brandName),
                            systemImage: store.selectedBrandName == brandName ? "checkmark.circle.fill" : "circle"
                        )
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Text(store.selectedBrandDisplayText)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                }
                .frame(minWidth: 130)
            }
            .menuStyle(.button)

            Text("Filters the snapshot, charts, records, and PDF export.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Spacer()
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.55), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct ImportBatchesView: View {
    @EnvironmentObject private var store: SalesStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Monthly Uploads")
                .font(.headline)

            Table(Array(store.filteredImportBatches.prefix(12))) {
                TableColumn("Sales Month") { batch in
                    Text(batch.salesMonth.salesLensMonthText)
                }
                .width(min: 110, ideal: 130)

                TableColumn("Received") { batch in
                    Text(batch.receivedDate?.salesLensDateText ?? "-")
                }
                .width(min: 110, ideal: 130)

                TableColumn("Rows") { batch in
                    Text("\(batch.rowCount)")
                        .monospacedDigit()
                }
                .width(min: 70, ideal: 80)

                TableColumn("Units") { batch in
                    Text("\(batch.units)")
                        .monospacedDigit()
                }
                .width(min: 80, ideal: 90)

                TableColumn("Sales") { batch in
                    Text(batch.sales.currencyText)
                        .monospacedDigit()
                }
                .width(min: 110, ideal: 130)

                TableColumn("File") { batch in
                    Text(batch.sourceFile)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(minHeight: 210)
        }
    }
}

private struct TopSellersView: View {
    @EnvironmentObject private var store: SalesStore
    @State private var isSavingImages = false
    @State private var isLoadingImages = false
    @State private var savedImagesMessage: String?
    @State private var productImages: [String: NSImage] = [:]

    private let columns = Array(repeating: GridItem(.flexible(minimum: 128), spacing: 12, alignment: .top), count: 5)
    private var tableHeight: CGFloat {
        CGFloat(store.topSellers.count + 1) * 30
    }

    private var showsImageGallery: Bool {
        store.selectedCustomer?.caseInsensitiveCompare("Rebel Rags") == .orderedSame
    }

    private var imageLoadKey: String {
        "\(store.selectedCustomer ?? "")|\(store.topSellers.map(\.id).joined(separator: "|"))"
    }

    private var topSellerTotalsText: String {
        let units = store.topSellers.reduce(0) { $0 + $1.units }
        let sales = store.topSellers.reduce(Decimal(0)) { $0 + $1.sales }
        let currentYearUnits = store.topSellers.reduce(0) { $0 + $1.currentYearUnits }
        let currentYearSales = store.topSellers.reduce(Decimal(0)) { $0 + $1.currentYearSales }
        return "Top 25 Total: \(units.formatted()) Units | \(sales.currencyText)    CY: \(currentYearUnits.formatted()) Units | \(currentYearSales.currencyText)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Top 25 by Art")
                        .font(.headline)
                    Text(store.selectedPeriodTitle)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    if !store.topSellers.isEmpty {
                        Text(topSellerTotalsText)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                }

                Spacer()

                if showsImageGallery {
                    if let savedImagesMessage {
                        Text(savedImagesMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Button {
                        saveImagesLocally()
                    } label: {
                        Label(isSavingImages ? "Refreshing Images" : "Refresh Images", systemImage: "arrow.clockwise")
                    }
                    .disabled(isSavingImages)
                }

                Menu {
                    ForEach(store.availableSalesMonths, id: \.self) { month in
                        Button {
                            store.selectTopSellerMonth(month)
                        } label: {
                            Label(
                                month.salesLensMonthText,
                                systemImage: store.selectedTopSellerMonth == month ? "checkmark.circle.fill" : "circle"
                            )
                        }
                    }
                } label: {
                    Label("Sales Month", systemImage: "calendar")
                }
                .menuStyle(.button)
            }

            if store.topSellers.isEmpty {
                Text("No seller data for this month.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
            } else if showsImageGallery {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                    ForEach(store.topSellers) { seller in
                        TopSellerArtCard(
                            seller: seller,
                            image: productImages[seller.id],
                            isLoadingImage: isLoadingImages
                        )
                    }
                }
                .task(id: imageLoadKey) {
                    await loadImages()
                }
            } else {
                Table(store.topSellers) {
                    TableColumn("#") { seller in Text("\(seller.rank)").monospacedDigit() }
                        .width(min: 44, ideal: 52)
                    TableColumn("Art Code") { seller in Text(seller.artCode) }
                        .width(min: 130, ideal: 170)
                    TableColumn("Style #") { seller in Text(seller.styleNumber) }
                        .width(min: 110, ideal: 140)
                    TableColumn("Brand/Class") { seller in Text(seller.brandName) }
                        .width(min: 95, ideal: 120)
                    TableColumn("Style Name") { seller in Text(seller.styleName) }
                        .width(min: 180, ideal: 260)
                    TableColumn("Color") { seller in Text(seller.colorName) }
                        .width(min: 120, ideal: 160)
                    TableColumn("Period") { seller in Text("\(seller.units.formatted()) | \(seller.sales.currencyText)").monospacedDigit() }
                        .width(min: 135, ideal: 160)
                    TableColumn("CY") { seller in Text("\(seller.currentYearUnits.formatted()) | \(seller.currentYearSales.currencyText)").monospacedDigit() }
                        .width(min: 135, ideal: 160)
                }
                .frame(height: tableHeight)
            }
        }
    }

    private func saveImagesLocally() {
        isSavingImages = true
        savedImagesMessage = nil
        let sellers = store.topSellers
        let customerName = store.selectedCustomer

        Task {
            let images = await RebelRagsProductImageService.shared.images(
                for: sellers,
                customerName: customerName,
                retryMissing: true
            )
            await MainActor.run {
                productImages.merge(images) { _, newImage in newImage }
                savedImagesMessage = "\(images.count) of \(sellers.count) images saved locally"
                isSavingImages = false
            }
        }
    }

    private func loadImages() async {
        guard showsImageGallery else { return }
        isLoadingImages = true
        savedImagesMessage = "Checking Rebel Rags images..."
        let sellers = store.topSellers
        let images = await RebelRagsProductImageService.shared.images(
            for: sellers,
            customerName: store.selectedCustomer,
            retryMissing: true
        )
        productImages = images
        savedImagesMessage = "\(images.count) of \(sellers.count) images available locally"
        isLoadingImages = false
    }
}

private struct TopSellerArtCard: View {
    let seller: TopSeller
    let image: NSImage?
    let isLoadingImage: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color(nsColor: .controlBackgroundColor))

                if let image {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFit()
                        .padding(5)
                } else if isLoadingImage {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    Image(systemName: "photo")
                        .font(.title3)
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                Text("#\(seller.rank)")
                    .font(.caption2.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 4))
                    .padding(6)
            }
            .frame(height: 136)

            VStack(alignment: .leading, spacing: 3) {
                detailRow(label: "Style", value: seller.styleNumber)
                detailRow(label: "Art", value: seller.artCode)
                detailRow(label: "Color", value: seller.colorName)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(seller.units.formatted()) Units")
                        Text("|")
                            .foregroundStyle(.secondary)
                        Text(seller.sales.currencyText)
                    }
                    Text("CY: \(seller.currentYearUnits.formatted()) Units | \(seller.currentYearSales.currencyText)")
                        .foregroundStyle(.secondary)
                }
                .font(.caption.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(.primary)
                .padding(.top, 3)
            }
        }
        .padding(8)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.48), in: RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(nsColor: .separatorColor).opacity(0.4), lineWidth: 0.5)
        }
    }

    @ViewBuilder
    private func detailRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(label)
                .foregroundStyle(.secondary)
            Text(value)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .font(.caption)
        .fontWeight(label == "Style" ? .semibold : .regular)
    }
}

private struct TopStylesView: View {
    @EnvironmentObject private var store: SalesStore

    private var tableHeight: CGFloat {
        CGFloat(store.monthlyStylesByUnits.count + 1) * 30
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("All Styles Sold")
                        .font(.headline)
                    Text(store.selectedPeriodTitle)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text("\(store.monthlyStylesByUnits.count) styles")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            if store.monthlyStylesByUnits.isEmpty {
                Text("No style data for this month.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
            } else {
                Table(store.monthlyStylesByUnits) {
                    TableColumn("#") { style in
                        Text("\(style.rank)")
                            .monospacedDigit()
                    }
                    .width(min: 42, ideal: 48)

                    TableColumn("Style #") { style in
                        Text(style.styleNumber)
                    }
                    .width(min: 90, ideal: 115)

                    TableColumn("Brand/Class") { style in
                        Text(style.brandName)
                    }
                    .width(min: 95, ideal: 120)

                    TableColumn("Transactions") { style in
                        Text("\(style.rowCount)")
                            .monospacedDigit()
                    }
                    .width(min: 90, ideal: 110)

                    TableColumn("Colors") { style in
                        Text("\(style.colorCount)")
                            .monospacedDigit()
                    }
                    .width(min: 65, ideal: 80)

                    TableColumn("Art Description") { style in
                        Text(style.artDetails)
                    }
                    .width(min: 260, ideal: 380)

                    TableColumn("Units") { style in
                        Text("\(style.units)")
                            .monospacedDigit()
                    }
                    .width(min: 70, ideal: 90)

                    TableColumn("Sales") { style in
                        Text(style.sales.currencyText)
                            .monospacedDigit()
                    }
                    .width(min: 110, ideal: 140)
                }
                .frame(height: tableHeight)
            }
        }
    }
}

private struct YearToDateTrackerView: View {
    @EnvironmentObject private var store: SalesStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let comparison = store.yearToDateComparison {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Year-To-Date Sales Tracker")
                            .font(.headline)
                        Text("Total sales from January through \(comparison.throughMonth.salesLensMonthOnlyText)")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Text("\(comparison.currentYearText) vs \(comparison.priorYearText)")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                Grid(horizontalSpacing: 12, verticalSpacing: 12) {
                    GridRow {
                        KPIView(title: "\(comparison.currentYearText) Jan-\(comparison.throughMonth.salesLensShortMonthText)", value: comparison.currentSales.currencyText, systemImage: "calendar")
                        KPIView(title: "\(comparison.priorYearText) Jan-\(comparison.throughMonth.salesLensShortMonthText)", value: comparison.priorYearSales.currencyText, systemImage: "calendar.badge.clock")
                        KPIView(
                            title: "Total Change",
                            value: "\(comparison.directionText.capitalized) \(comparison.salesPercentChange.map { abs($0).percentageText } ?? "-")",
                            systemImage: comparison.salesDifference >= 0 ? "arrow.up.right.circle" : "arrow.down.right.circle"
                        )
                    }
                }

                YearToDateTrendChart(comparison: comparison)
            }
        }
    }
}

private struct YearToDateTrendChart: View {
    let comparison: YearToDateComparison

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Running Sales Trend")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                Text("\(comparison.currentYearText) is \(comparison.directionText) \(comparison.salesPercentChange.map { abs($0).percentageText } ?? "from no prior sales")")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(comparison.salesDifference >= 0 ? .green : .red)
                    .monospacedDigit()
            }

            Chart {
                ForEach(comparison.months) { month in
                    LineMark(
                        x: .value("Month", month.monthName),
                        y: .value("Sales", decimalDouble(month.currentRunningSales))
                    )
                    .foregroundStyle(by: .value("Year", comparison.currentYearText))
                    .interpolationMethod(.catmullRom)

                    PointMark(
                        x: .value("Month", month.monthName),
                        y: .value("Sales", decimalDouble(month.currentRunningSales))
                    )
                    .foregroundStyle(by: .value("Year", comparison.currentYearText))

                    LineMark(
                        x: .value("Month", month.monthName),
                        y: .value("Sales", decimalDouble(month.priorYearRunningSales))
                    )
                    .foregroundStyle(by: .value("Year", comparison.priorYearText))
                    .interpolationMethod(.catmullRom)

                    PointMark(
                        x: .value("Month", month.monthName),
                        y: .value("Sales", decimalDouble(month.priorYearRunningSales))
                    )
                    .foregroundStyle(by: .value("Year", comparison.priorYearText))
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading)
            }
            .frame(height: 220)
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct HeaderView: View {
    @EnvironmentObject private var store: SalesStore

    var title: String {
        store.selectedCustomer ?? "All Customers"
    }

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.title2.weight(.semibold))
                Text("Compare imported POS sales by month, year, and customer.")
                    .font(.callout)
                    .foregroundStyle(.secondary)

                if !store.uploadCoverageLines.isEmpty {
                    HStack(spacing: 14) {
                        ForEach(store.uploadCoverageLines, id: \.customer) { coverage in
                            HStack(spacing: 6) {
                                Text(store.selectedCustomer == nil ? "\(coverage.customer) Last Date Uploaded:" : "Last Date Uploaded:")
                                    .foregroundStyle(.secondary)
                                Text(coverage.value)
                                    .fontWeight(.semibold)
                                    .monospacedDigit()
                            }
                            .font(.caption)
                        }
                    }
                    .padding(.top, 3)
                }
            }

            Spacer()

            Picker("Period", selection: $store.period) {
                ForEach(Period.allCases) { period in
                    Text(period.rawValue).tag(period)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 180)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
        .background(.bar)
    }
}

private struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 56))
                .foregroundStyle(.blue)

            Text("Import POS files to begin")
                .font(.title3.weight(.semibold))

            Text("Use monthly POS exports like the Volshop Excel XML file, or CSV files with customer, date, sales, and unit columns.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 520)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
    }
}

private struct SalesSnapshotView: View {
    @EnvironmentObject private var store: SalesStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Sales Snapshot")
                        .font(.headline)
                    Text(snapshotSubtitle)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Menu {
                    ForEach(store.availableSalesMonths, id: \.self) { month in
                        Button {
                            store.selectTopSellerMonth(month)
                        } label: {
                            Label(
                                month.salesLensMonthText,
                                systemImage: store.selectedSalesMonth == month ? "checkmark.circle.fill" : "circle"
                            )
                        }
                    }
                } label: {
                    Label("Sales Month", systemImage: "calendar")
                }
                .menuStyle(.button)
            }

            if let comparison = store.yearOverYearComparison {
                Grid(horizontalSpacing: 12, verticalSpacing: 12) {
                    GridRow {
                        SnapshotMetricCard(
                            title: store.selectedPeriodTitle,
                            systemImage: "calendar",
                            rows: [
                                ("Sales", comparison.currentSales.currencyText),
                                ("Units", "\(comparison.currentUnits)"),
                                ("Transactions", "\(comparison.currentTransactions)")
                            ]
                        )

                        SnapshotMetricCard(
                            title: store.selectedPriorYearPeriodTitle ?? comparison.priorYearMonth.salesLensMonthText,
                            systemImage: "calendar.badge.clock",
                            rows: [
                                ("Sales", comparison.priorYearSales.currencyText),
                                ("Units", "\(comparison.priorYearUnits)"),
                                ("Transactions", "\(comparison.priorYearTransactions)")
                            ]
                        )

                        SnapshotChangeCard(comparison: comparison)
                    }
                }
            } else {
                Grid(horizontalSpacing: 12, verticalSpacing: 12) {
                    GridRow {
                        SnapshotMetricCard(
                            title: store.selectedPeriodTitle,
                            systemImage: "calendar",
                            rows: [
                                ("Sales", store.selectedPeriodSales.currencyText),
                                ("Units", "\(store.selectedPeriodUnits)"),
                                ("Transactions", "\(store.selectedPeriodTransactions)")
                            ]
                        )

                        Text("No matching prior-year month is available for \(store.selectedSalesMonth?.salesLensMonthText ?? "the selected month").")
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(14)
                            .frame(maxWidth: .infinity, minHeight: 124, alignment: .leading)
                            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }

            if let summary = store.bestSalesDaySummary {
                BestSalesDayView(summary: summary, periodTitle: store.selectedPeriodTitle)
            }
        }
    }

    private var snapshotSubtitle: String {
        guard store.selectedSalesMonth != nil else { return "No sales month selected" }
        guard store.yearOverYearComparison != nil,
              let priorTitle = store.selectedPriorYearPeriodTitle else {
            return store.selectedPeriodTitle
        }
        return "\(store.selectedPeriodTitle) vs \(priorTitle)"
    }
}

private struct BestSalesDayView: View {
    let summary: BestSalesDaySummary
    let periodTitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(summary.usesDailyTransactions ? "Best Sales Day" : "Top 5 Items Sold")
                        .font(.subheadline.weight(.semibold))
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                HStack(spacing: 14) {
                    bestDayMetric(summary.sales.currencyText, label: "Sales")
                    bestDayMetric("\(summary.units)", label: "Units")
                    bestDayMetric("\(summary.transactions)", label: "Transactions")
                }
            }

            if !summary.usesDailyTransactions {
                Text("Volshop imports provide monthly reporting totals, so an individual highest-sales day is not available.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Chart(summary.topItems) { item in
                BarMark(
                    x: .value("Sales", decimalDouble(item.sales)),
                    y: .value("Item", barLabel(for: item))
                )
                .foregroundStyle(Color.accentColor.gradient)
                .annotation(position: .trailing, alignment: .leading) {
                    Text("\(item.units) units | \(item.sales.currencyText)")
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                }
            }
            .chartXAxis {
                AxisMarks(position: .bottom) {
                    AxisGridLine()
                    AxisValueLabel(format: .currency(code: "USD").precision(.fractionLength(0)))
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading)
            }
            .frame(height: 160)
            .padding(.trailing, 120)
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
    }

    private var subtitle: String {
        if let date = summary.date, summary.usesDailyTransactions {
            return "\(date.salesLensDateText) top products by sales"
        }
        return "\(periodTitle) top products by sales"
    }

    private func barLabel(for item: BestSalesDayItem) -> String {
        "\(item.rank). \(item.styleNumber)  \(item.artCode)  \(item.colorName)"
    }

    @ViewBuilder
    private func bestDayMetric(_ value: String, label: String) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.semibold))
                .monospacedDigit()
        }
    }
}

private struct SnapshotMetricCard: View {
    let title: String
    let systemImage: String
    let rows: [(String, String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 8))

                Text(title)
                    .font(.subheadline.weight(.semibold))

                Spacer(minLength: 0)
            }

            VStack(spacing: 8) {
                ForEach(rows, id: \.0) { row in
                    SnapshotMetricRow(label: row.0, value: row.1)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 124, alignment: .topLeading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct SnapshotChangeCard: View {
    @EnvironmentObject private var store: SalesStore
    let comparison: MonthComparison

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: (comparison.salesPercentChange ?? 0) >= 0 ? "arrow.up.right.circle" : "arrow.down.right.circle")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(changeColor, in: RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 2) {
                    Text("Year-over-Year Change")
                        .font(.subheadline.weight(.semibold))
                    Text("\(store.selectedPeriodTitle) vs last year")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }

            VStack(spacing: 8) {
                SnapshotDeltaRow(
                    label: "Sales",
                    value: comparison.salesPercentChange.map { $0.signedPercentageText } ?? "-",
                    detail: comparison.salesDifference.signedCurrencyText,
                    isPositive: comparison.salesDifference >= 0
                )
                SnapshotDeltaRow(
                    label: "Units",
                    value: unitPercentText,
                    detail: comparison.unitDifference.signedNumberText,
                    isPositive: comparison.unitDifference >= 0
                )
                SnapshotDeltaRow(
                    label: "Inventory",
                    value: comparison.inventoryPercentChange.map { $0.signedPercentageText } ?? "-",
                    detail: comparison.inventoryDifference.signedNumberText,
                    isPositive: comparison.inventoryDifference >= 0
                )
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 124, alignment: .topLeading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
    }

    private var changeColor: Color {
        comparison.salesDifference >= 0 ? .green : .red
    }

    private var unitPercentText: String {
        guard comparison.priorYearUnits != 0 else { return "-" }
        let percent = (Double(comparison.currentUnits - comparison.priorYearUnits) / Double(comparison.priorYearUnits)) * 100
        return percent.signedPercentageText
    }
}

private struct SnapshotMetricRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.callout.weight(.semibold))
                .monospacedDigit()
        }
    }
}

private struct SnapshotDeltaRow: View {
    let label: String
    let value: String
    let detail: String
    let isPositive: Bool

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 64, alignment: .leading)

            Text(value)
                .font(.callout.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(isPositive ? .green : .red)

            Spacer(minLength: 0)

            Text(detail)
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
    }
}

private struct CustomerClassMixView: View {
    @EnvironmentObject private var store: SalesStore

    private let colors: [String: Color] = [
        "Unisex": Color(red: 0.05, green: 0.45, blue: 0.84),
        "Women's": Color(red: 0.91, green: 0.30, blue: 0.52),
        "Youth": Color(red: 0.97, green: 0.61, blue: 0.12)
    ]

    private var totalUnits: Int {
        store.selectedCustomerClassMix.reduce(0) { $0 + $1.units }
    }

    var body: some View {
        if let salesMixCustomerName = store.salesMixCustomerName,
           !store.selectedCustomerClassMix.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(salesMixCustomerName) Sales Mix")
                        .font(.headline)
                    Text("\(store.selectedPeriodTitle) units by Unisex, Women's, and Youth classification")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 28) {
                    AudiencePieChart(
                        slices: store.selectedCustomerClassMix,
                        colors: colors,
                        totalUnits: totalUnits
                    )
                    .frame(width: 330, height: 265)

                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(store.selectedCustomerClassMix) { slice in
                            HStack(spacing: 10) {
                                Circle()
                                    .fill(colors[slice.name] ?? .gray)
                                    .frame(width: 11, height: 11)

                                Text(slice.name)
                                    .font(.callout.weight(.semibold))
                                    .frame(width: 78, alignment: .leading)

                                Text("\(slice.units.formatted()) units")
                                    .font(.callout.weight(.semibold))
                                    .monospacedDigit()

                                Text(percentText(for: slice))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }
                        }

                        Divider()

                        HStack {
                            Text("Total Sold")
                                .font(.callout.weight(.semibold))
                            Spacer()
                            Text("\(totalUnits.formatted()) units")
                                .font(.callout.weight(.bold))
                                .monospacedDigit()
                        }
                    }
                    .frame(maxWidth: 300, alignment: .leading)

                    Spacer()
                }
            }
            .padding(16)
            .background(Color(nsColor: .controlBackgroundColor).opacity(0.55), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func percentText(for slice: VolshopClassSlice) -> String {
        guard totalUnits > 0 else { return "" }
        return (Double(slice.units) / Double(totalUnits)).formatted(.percent.precision(.fractionLength(1)))
    }
}

private struct AudiencePieChart: View {
    let slices: [VolshopClassSlice]
    let colors: [String: Color]
    let totalUnits: Int

    var body: some View {
        GeometryReader { proxy in
            let diameter = min(proxy.size.width, proxy.size.height) - 22
            let chartRect = CGRect(
                x: (proxy.size.width - diameter) / 2,
                y: (proxy.size.height - diameter) / 2,
                width: diameter,
                height: diameter
            )
            let center = CGPoint(x: chartRect.midX, y: chartRect.midY)

            ZStack {
                Canvas { context, _ in
                    var startAngle = Angle.degrees(-90)
                    for slice in slices {
                        let sweep = Angle.degrees(360 * Double(slice.units) / Double(max(totalUnits, 1)))
                        var path = Path()
                        path.move(to: center)
                        path.addArc(
                            center: center,
                            radius: chartRect.width / 2,
                            startAngle: startAngle,
                            endAngle: startAngle + sweep,
                            clockwise: false
                        )
                        path.closeSubpath()
                        context.fill(path, with: .color(colors[slice.name] ?? .gray))
                        context.stroke(path, with: .color(Color(nsColor: .controlBackgroundColor)), lineWidth: 2)
                        startAngle += sweep
                    }
                }

                ForEach(Array(slices.enumerated()), id: \.element.id) { index, slice in
                    let position = labelPosition(for: index, in: chartRect)
                    Text("\(slice.name)\n\(slice.units.formatted())")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .monospacedDigit()
                        .multilineTextAlignment(.center)
                        .shadow(color: .black.opacity(0.2), radius: 1, y: 1)
                        .position(position)
                }
            }
        }
    }

    private func labelPosition(for index: Int, in rect: CGRect) -> CGPoint {
        let unitsBefore = slices.prefix(index).reduce(0) { $0 + $1.units }
        let midpointUnits = Double(unitsBefore) + Double(slices[index].units) / 2
        let angle = midpointUnits / Double(max(totalUnits, 1)) * 2 * Double.pi - Double.pi / 2
        let share = Double(slices[index].units) / Double(max(totalUnits, 1))
        let radius = rect.width * (share < 0.13 ? 0.42 : 0.29)
        return CGPoint(
            x: rect.midX + cos(angle) * radius,
            y: rect.midY + sin(angle) * radius
        )
    }
}

private struct TopFiveStyleComparisonView: View {
    @EnvironmentObject private var store: SalesStore

    private var maxUnits: Int {
        max(
            store.topStyleMonthComparisons.flatMap { [$0.currentUnits, $0.priorYearUnits] }.max() ?? 0,
            1
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Top 10 Styles vs Last Year")
                    .font(.headline)
                if let comparison = store.yearOverYearComparison {
                    Text("\(store.selectedPeriodTitle) vs \(store.selectedPriorYearPeriodTitle ?? comparison.priorYearMonth.salesLensMonthText)")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    Text(store.selectedPeriodTitle)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }

            if store.topStyleMonthComparisons.isEmpty {
                Text("No style comparison is available for the selected month.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
            } else {
                VStack(spacing: 10) {
                    ForEach(store.topStyleMonthComparisons) { style in
                        TopFiveStyleComparisonRow(style: style, maxUnits: maxUnits)
                    }
                }
            }
        }
    }
}

private struct TopFiveStyleComparisonRow: View {
    let style: TopStyleMonthComparison
    let maxUnits: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(style.rank)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 22, alignment: .leading)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(style.styleNumber)
                            .font(.callout.weight(.semibold))
                        Text(style.brandName)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        currentScopeLine
                        priorYearScopeLine
                    }
                    .font(.caption)
                    .lineLimit(1)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(style.currentUnits) vs \(style.priorYearUnits) units")
                        .font(.callout.weight(.semibold))
                        .monospacedDigit()
                    Text("Art codes \(style.artCount) vs \(style.priorYearArtCount) (\(style.artCountChange.signedNumberText)); sales \(style.salesChange.signedCurrencyText) (\(style.salesPercentChange.map { $0.percentageText } ?? "-"))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }

            VStack(spacing: 5) {
                comparisonBar(label: "CY", value: style.currentUnits, color: .accentColor)
                comparisonBar(label: "LY", value: style.priorYearUnits, color: .secondary.opacity(0.55))
            }
        }
        .padding(12)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
    }

    private func comparisonBar(label: String, value: Int, color: Color) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 24, alignment: .leading)

            GeometryReader { proxy in
                let width = proxy.size.width * CGFloat(value) / CGFloat(maxUnits)
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color(nsColor: .separatorColor).opacity(0.35))
                    RoundedRectangle(cornerRadius: 4)
                        .fill(color)
                        .frame(width: max(width, value == 0 ? 0 : 4))
                }
            }
            .frame(height: 8)

            Text("\(value)")
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 46, alignment: .trailing)
        }
    }

    private var currentScopeLine: Text {
        Text("CY: ")
            .foregroundColor(.secondary)
        + Text(countText(style.colorCount, singular: "Color", plural: "Colors"))
            .foregroundColor(comparisonColor(current: style.colorCount, previous: style.priorYearColorCount))
        + Text(", ")
            .foregroundColor(.secondary)
        + Text(countText(style.artCount, singular: "Artwork", plural: "Artworks"))
            .foregroundColor(comparisonColor(current: style.artCount, previous: style.priorYearArtCount))
    }

    private var priorYearScopeLine: Text {
        Text("LY: ")
            .foregroundColor(.secondary)
        + Text(countText(style.priorYearColorCount, singular: "Color", plural: "Colors"))
            .foregroundColor(comparisonColor(current: style.priorYearColorCount, previous: style.colorCount))
        + Text(", ")
            .foregroundColor(.secondary)
        + Text(countText(style.priorYearArtCount, singular: "Artwork", plural: "Artworks"))
            .foregroundColor(comparisonColor(current: style.priorYearArtCount, previous: style.artCount))
    }

    private func countText(_ count: Int, singular: String, plural: String) -> String {
        "\(count) \(count == 1 ? singular : plural)"
    }

    private func comparisonColor(current: Int, previous: Int) -> Color {
        if current > previous {
            return .green
        } else if current < previous {
            return .red
        } else {
            return .secondary
        }
    }
}

private struct StyleSignalsView: View {
    @EnvironmentObject private var store: SalesStore

    private let columns = [
        GridItem(.flexible(minimum: 260), spacing: 12, alignment: .top),
        GridItem(.flexible(minimum: 260), spacing: 12, alignment: .top),
        GridItem(.flexible(minimum: 260), spacing: 12, alignment: .top)
    ]

    var body: some View {
        let groups = store.styleSignalGroups

        if !groups.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Style Signals")
                        .font(.headline)
                    Text("Where the business is gaining, leaking, expanding, or losing assortment breadth.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                    ForEach(groups) { group in
                        StyleSignalCard(group: group)
                    }
                }
            }
        }
    }
}

private struct StyleSignalCard: View {
    let group: StyleSignalGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: iconName)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(accentColor.gradient, in: RoundedRectangle(cornerRadius: 7))

                VStack(alignment: .leading, spacing: 2) {
                    Text(group.kind.title)
                        .font(.callout.weight(.semibold))
                    Text(group.kind.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(spacing: 8) {
                ForEach(group.items) { item in
                    StyleSignalRow(item: item, kind: group.kind, accentColor: accentColor)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
    }

    private var accentColor: Color {
        switch group.kind {
        case .growthDrivers, .assortmentExpansion, .efficientWinners:
            return .green
        case .decliners, .assortmentContraction, .missingLastYearSellers:
            return .red
        }
    }

    private var iconName: String {
        switch group.kind {
        case .growthDrivers:
            return "chart.line.uptrend.xyaxis"
        case .decliners:
            return "chart.line.downtrend.xyaxis"
        case .assortmentExpansion:
            return "plus.rectangle.on.rectangle"
        case .assortmentContraction:
            return "minus.rectangle"
        case .efficientWinners:
            return "bolt.fill"
        case .missingLastYearSellers:
            return "exclamationmark.triangle.fill"
        }
    }
}

private struct StyleSignalRow: View {
    let item: StyleSignalItem
    let kind: StyleSignalKind
    let accentColor: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(item.rank)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 18, alignment: .leading)

                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(item.styleNumber)
                            .font(.caption.weight(.semibold))
                        Text(item.brandName)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }

                    Text(item.styleName)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 1) {
                    Text(primaryValue)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(accentColor)
                        .monospacedDigit()
                    Text("\(item.currentUnits) vs \(item.priorYearUnits) units")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }

            scopeLine
                .font(.caption2)
                .lineLimit(1)
        }
    }

    private var primaryValue: String {
        switch kind {
        case .missingLastYearSellers:
            return "LY \(item.priorYearSales.currencyText)"
        default:
            return item.salesChange.signedCurrencyText
        }
    }

    private var scopeLine: Text {
        Text("CY: ")
            .foregroundColor(.secondary)
        + Text(countText(item.colorCount, singular: "Color", plural: "Colors"))
            .foregroundColor(comparisonColor(current: item.colorCount, previous: item.priorYearColorCount))
        + Text(", ")
            .foregroundColor(.secondary)
        + Text(countText(item.artCount, singular: "Artwork", plural: "Artworks"))
            .foregroundColor(comparisonColor(current: item.artCount, previous: item.priorYearArtCount))
        + Text(" | LY: ")
            .foregroundColor(.secondary)
        + Text(countText(item.priorYearColorCount, singular: "Color", plural: "Colors"))
            .foregroundColor(comparisonColor(current: item.priorYearColorCount, previous: item.colorCount))
        + Text(", ")
            .foregroundColor(.secondary)
        + Text(countText(item.priorYearArtCount, singular: "Artwork", plural: "Artworks"))
            .foregroundColor(comparisonColor(current: item.priorYearArtCount, previous: item.artCount))
    }

    private func countText(_ count: Int, singular: String, plural: String) -> String {
        "\(count) \(count == 1 ? singular : plural)"
    }

    private func comparisonColor(current: Int, previous: Int) -> Color {
        if current > previous {
            return .green
        } else if current < previous {
            return .red
        } else {
            return .secondary
        }
    }
}

private struct KPIView: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.title3.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 74)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct RecordsTableView: View {
    @EnvironmentObject private var store: SalesStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Imported Records")
                .font(.headline)

            Table(store.filteredRecords) {
                TableColumn("Date") { record in
                    Text(record.date.salesLensMonthText)
                }
                .width(min: 110, ideal: 130)

                TableColumn("Customer") { record in
                    Text(record.customerName)
                }
                .width(min: 160, ideal: 220)

                TableColumn("Style Name") { record in
                    Text(record.masterStyle ?? "-")
                }
                .width(min: 180, ideal: 260)

                TableColumn("Brand/Class") { record in
                    Text(store.displayBrandName(for: record))
                }
                .width(min: 110, ideal: 140)

                TableColumn("Style #") { record in
                    Text(record.styleNumber ?? record.rawStyleIdentifier ?? "-")
                }
                .width(min: 130, ideal: 160)

                TableColumn("Color Code") { record in
                    Text(record.colorCode ?? "-")
                }
                .width(min: 95, ideal: 120)

                TableColumn("Catalog Color") { record in
                    Text(record.catalogColorName ?? record.color ?? "-")
                }
                .width(min: 120, ideal: 150)

                TableColumn("Art Code") { record in
                    Text(record.artCode ?? "-")
                }
                .width(min: 120, ideal: 150)

                TableColumn("Sales") { record in
                    Text(record.amount.currencyText)
                        .monospacedDigit()
                }
                .width(min: 110, ideal: 140)

                TableColumn("Units") { record in
                    Text(record.units.map(String.init) ?? "-")
                        .monospacedDigit()
                }
                .width(min: 70, ideal: 90)

            }
            .frame(minHeight: 260)
        }
    }
}

private extension Decimal {
    var currencyText: String {
        DisplayFormatters.currency.string(from: NSDecimalNumber(decimal: self)) ?? "$0.00"
    }

    var signedCurrencyText: String {
        let text = currencyText
        return self > 0 ? "+\(text)" : text
    }
}

private func decimalDouble(_ value: Decimal) -> Double {
    NSDecimalNumber(decimal: value).doubleValue
}

private extension Double {
    var percentageText: String {
        DisplayFormatters.percent.string(from: NSNumber(value: self / 100)) ?? "\(self)%"
    }

    var signedPercentageText: String {
        self > 0 ? "+\(percentageText)" : percentageText
    }
}

private extension Int {
    var signedNumberText: String {
        self > 0 ? "+\(self)" : "\(self)"
    }
}

private extension MonthComparison {
    var salesDifference: Decimal {
        currentSales - priorYearSales
    }

    var unitDifference: Int {
        currentUnits - priorYearUnits
    }

    var inventoryDifference: Int {
        currentInventoryUnits - priorYearInventoryUnits
    }
}

private extension YearToDateComparison {
    var currentYearText: String {
        String(currentYear)
    }

    var priorYearText: String {
        String(priorYear)
    }
}
