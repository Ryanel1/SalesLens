import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var store: SalesStore
    @State private var isImporting = false
    @State private var isConfirmingClear = false
    @State private var isShowingUploadManager = false
    @State private var pendingImportURLs: [URL] = []
    @State private var isChoosingImportAccount = false
    @State private var isExportingPDF = false

    var body: some View {
        NavigationSplitView {
            SidebarView()
        } detail: {
            DashboardView()
        }
        .fileImporter(
            isPresented: $isImporting,
            allowedContentTypes: [.commaSeparatedText, .plainText, .salesLensExcelXML, .salesLensXLSX],
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls):
                pendingImportURLs = urls
                isChoosingImportAccount = !urls.isEmpty
            case .failure(let error):
                store.importError = error.localizedDescription
            }
        }
        .alert("Import Complete", isPresented: Binding(
            get: { store.importSummary != nil },
            set: { if !$0 { store.importSummary = nil } }
        )) {
            Button("OK") {}
        } message: {
            Text(store.importSummary.map(importSummaryMessage) ?? "")
        }
        .alert("SalesLens", isPresented: Binding(
            get: { store.importError != nil },
            set: { if !$0 { store.importError = nil } }
        )) {
            Button("OK") {}
        } message: {
            Text(store.importError ?? "")
        }
        .confirmationDialog(
            "Clear all imported sales records?",
            isPresented: $isConfirmingClear,
            titleVisibility: .visible
        ) {
            Button("Clear All", role: .destructive) {
                store.clearAll()
            }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $isShowingUploadManager) {
            UploadManagementView(
                isImporting: $isImporting,
                isConfirmingClear: $isConfirmingClear,
                isPresented: $isShowingUploadManager
            )
            .environmentObject(store)
        }
        .sheet(isPresented: $isChoosingImportAccount) {
            ImportAccountSelectionView(
                urls: pendingImportURLs,
                isPresented: $isChoosingImportAccount
            ) { account in
                pendingImportURLs.forEach { store.importPOSFile(from: $0, accountName: account) }
                pendingImportURLs.removeAll()
            }
            .environmentObject(store)
        }
        .toolbar {
            ToolbarItemGroup {
                Button {
                    isShowingUploadManager = true
                } label: {
                    Label("Uploads", systemImage: "tray.full")
                }

                Menu {
                    Button {
                        exportSnapshotPDF(period: .monthly)
                    } label: {
                        Label("Monthly Report", systemImage: "calendar")
                    }

                    Button {
                        exportSnapshotPDF(period: .yearly)
                    } label: {
                        Label("Jan 1 - Selected Month", systemImage: "chart.line.uptrend.xyaxis")
                    }
                } label: {
                    Label("Export PDF", systemImage: "doc.richtext")
                }
                .disabled(store.records.isEmpty || isExportingPDF)

                Button {
                    isImporting = true
                } label: {
                    Label("Import POS File", systemImage: "square.and.arrow.down")
                }

                Button(role: .destructive) {
                    isConfirmingClear = true
                } label: {
                    Label("Clear Data", systemImage: "trash")
                }
                .disabled(store.records.isEmpty)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openImportPanel)) { _ in
            isImporting = true
        }
    }

    private func exportSnapshotPDF(period exportPeriod: Period) {
        let originalPeriod = store.period
        store.period = exportPeriod
        let exportTitle = store.selectedPeriodTitle
        store.period = originalPeriod

        let selectedMonth = exportTitle.replacingOccurrences(of: " ", with: "-")
        let customer = (store.selectedCustomer ?? "All-Customers").replacingOccurrences(of: " ", with: "-")
        let scope = exportPeriod == .monthly ? "Monthly" : "YTD"
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = "SalesLens-\(customer)-\(scope)-\(selectedMonth).pdf"

        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }

            Task { @MainActor in
                isExportingPDF = true
                let originalPeriod = store.period
                store.period = exportPeriod
                defer {
                    store.period = originalPeriod
                    isExportingPDF = false
                }

                let productImages = await RebelRagsProductImageService.shared.images(
                    for: store.topSellers,
                    customerName: store.selectedCustomer,
                    retryMissing: true
                )

                do {
                    try SalesSnapshotPDFExporter.export(store: store, productImages: productImages, to: url)
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                } catch {
                    store.importError = "Could not export PDF: \(error.localizedDescription)"
                }
            }
        }
    }

}

@MainActor
private enum SalesSnapshotPDFExporter {
    private static let pageSize = CGSize(width: 792, height: 612)
    private static let margin: CGFloat = 36
    private static var theme = PDFTheme.neutral
    private static var pageFill: NSColor { theme.pageFill }
    private static var ink: NSColor { theme.ink }
    private static var mutedInk: NSColor { theme.mutedInk }
    private static var cardFill: NSColor { theme.cardFill }
    private static var cardStroke: NSColor { theme.cardStroke }
    private static var headerFill: NSColor { theme.headerFill }
    private static var tableStripe: NSColor { theme.tableStripe }
    private static var barTrack: NSColor { theme.barTrack }
    private static var rule: NSColor { theme.rule }
    private static var accent: NSColor { theme.accent }
    private static var secondaryAccent: NSColor { theme.secondaryAccent }
    private static var positive: NSColor { theme.positive }
    private static var negative: NSColor { theme.negative }

    static func export(store: SalesStore, productImages: [String: NSImage], to url: URL) throws {
        theme = PDFTheme.forCustomer(store.selectedCustomer)
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data as CFMutableData) else {
            throw CocoaError(.fileWriteUnknown)
        }

        var mediaBox = CGRect(origin: .zero, size: pageSize)
        guard let context = CGContext(consumer: consumer, mediaBox: &mediaBox, nil) else {
            throw CocoaError(.fileWriteUnknown)
        }

        let graphicsContext = NSGraphicsContext(cgContext: context, flipped: false)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = graphicsContext
        defer { NSGraphicsContext.restoreGraphicsState() }

        var y = margin
        context.beginPDFPage(nil)
        drawPageBackground()
        drawHeader(store: store, y: &y)
        drawYearToDate(store: store, y: &y)
        drawMonthSummary(store: store, y: &y)
        if !store.styleSignalGroups.isEmpty {
            startNewPage(store: store, y: &y, context: context)
            drawStyleSignals(store: store, y: &y, context: context)
        }
        startNewPage(store: store, y: &y, context: context)
        drawTopStyleComparisons(store: store, y: &y, context: context)
        if store.selectedCustomer?.caseInsensitiveCompare("Rebel Rags") == .orderedSame {
            startNewGalleryPage(store: store, y: &y, context: context)
        } else {
            startNewPage(store: store, y: &y, context: context)
        }
        drawTopSellers(store: store, productImages: productImages, y: &y, context: context)
        startNewPage(store: store, y: &y, context: context)
        drawAllStyles(store: store, y: &y, context: context)
        context.endPDFPage()
        context.closePDF()

        try data.write(to: url, options: .atomic)
    }

    private static func drawHeader(store: SalesStore, y: inout CGFloat, compact: Bool = false) {
        drawCompactHeader(store: store, y: &y)
    }

    private static func drawCompactHeader(store: SalesStore, y: inout CGFloat) {
        drawText("LESTER SALES", x: margin, y: y, width: 150, height: 17, font: .boldSystemFont(ofSize: 13), color: accent)
        drawText("Ryan Lester  |  P: (502) 689-7374  |  E: ryanlestersells@gmail.com  |  W: lestersales.net", x: margin, y: y + 18, width: 440, height: 10, font: .systemFont(ofSize: 6.5), color: mutedInk)
        drawText("\(store.selectedCustomer ?? "All Customers")  |  \(store.selectedPeriodTitle)", x: pageSize.width - margin - 270, y: y + 1, width: 270, height: 13, font: .boldSystemFont(ofSize: 8), alignment: .right, color: ink)
        drawLine(y: y + 35)
        y += 48
    }

    private static func drawYearToDate(store: SalesStore, y: inout CGFloat) {
        guard let comparison = store.yearToDateComparison else { return }

        drawSectionTitle("Year-To-Date Sales Tracker", y: &y)
        drawText("Total sales from January through \(comparison.throughMonth.salesLensMonthOnlyText), compared to the same date range last year.", x: margin, y: y, width: 650, height: 16, color: mutedInk)
        y += 21

        let cardWidth = (pageSize.width - (margin * 2) - 24) / 3
        drawMetricCard(title: "\(comparison.currentYearText) Jan-\(comparison.throughMonth.salesLensShortMonthText)", value: comparison.currentSales.currencyText, x: margin, y: y, width: cardWidth, height: 52)
        drawMetricCard(title: "\(comparison.priorYearText) Jan-\(comparison.throughMonth.salesLensShortMonthText)", value: comparison.priorYearSales.currencyText, x: margin + cardWidth + 12, y: y, width: cardWidth, height: 52)
        drawMetricCard(title: "Total Change", value: "\(comparison.directionText.capitalized) \(comparison.salesPercentChange.map { abs($0).percentageText } ?? "-")", detail: comparison.salesDifference.signedCurrencyText, x: margin + (cardWidth + 12) * 2, y: y, width: cardWidth, height: 52)
        y += 55

        drawYearToDateChart(comparison, y: y, height: 68)
        y += 84
    }

    private static func drawMonthSummary(store: SalesStore, y: inout CGFloat) {
        drawSectionTitle("Month Summary", y: &y)
        drawText(store.selectedPeriodTitle, x: margin, y: y, width: 300, height: 18, color: mutedInk)
        y += 22

        let cardWidth = (pageSize.width - (margin * 2) - 36) / 4
        drawMetricCard(title: "Sales", value: store.selectedPeriodSales.currencyText, x: margin, y: y, width: cardWidth, height: 46)
        drawMetricCard(title: "Transactions", value: "\(store.selectedPeriodTransactions)", x: margin + cardWidth + 12, y: y, width: cardWidth, height: 46)
        drawMetricCard(title: "Units", value: "\(store.selectedPeriodUnits)", x: margin + (cardWidth + 12) * 2, y: y, width: cardWidth, height: 46)

        if let comparison = store.yearOverYearComparison {
            drawMetricCard(title: "Last Year Sales", value: comparison.priorYearSales.currencyText, x: margin + (cardWidth + 12) * 3, y: y, width: cardWidth, height: 46)
            y += 52
            let widgetGap: CGFloat = 10
            let widgetWidth = (pageSize.width - margin * 2 - widgetGap * 2) / 3
            let widgetHeight: CGFloat = 78
            drawSalesMixUnits(store: store, frame: CGRect(x: margin, y: y, width: widgetWidth, height: widgetHeight))
            drawMonthSalesChart(
                comparison,
                currentTitle: store.selectedPeriodTitle,
                priorTitle: store.selectedPriorYearPeriodTitle ?? comparison.priorYearMonth.salesLensMonthText,
                frame: CGRect(x: margin + widgetWidth + widgetGap, y: y, width: widgetWidth, height: widgetHeight)
            )
            drawBestSalesDayWidget(store: store, frame: CGRect(x: margin + (widgetWidth + widgetGap) * 2, y: y, width: widgetWidth, height: widgetHeight))
            y += widgetHeight + 8
            drawSummaryReadouts(store: store, comparison: comparison, y: &y)
        } else {
            y += 52
            if !store.selectedCustomerClassMix.isEmpty {
                let widgetGap: CGFloat = 10
                let widgetWidth = (pageSize.width - margin * 2 - widgetGap) / 2
                drawSalesMixUnits(store: store, frame: CGRect(x: margin, y: y, width: widgetWidth, height: 78))
                drawBestSalesDayWidget(store: store, frame: CGRect(x: margin + widgetWidth + widgetGap, y: y, width: widgetWidth, height: 78))
                y += 86
                drawSummaryReadouts(store: store, comparison: nil, y: &y)
            }
        }
    }

    private static func drawYearToDateChart(_ comparison: YearToDateComparison, y: CGFloat, height: CGFloat) {
        let frame = CGRect(x: margin, y: y, width: pageSize.width - margin * 2, height: height)
        drawRoundedRect(frame, fill: tableStripe)
        drawText("Running Sales", x: frame.minX + 10, y: y + 8, width: 90, height: 12, font: .boldSystemFont(ofSize: 8), color: mutedInk)
        drawText(comparison.currentYearText, x: frame.maxX - 146, y: y + 8, width: 42, height: 12, font: .boldSystemFont(ofSize: 8), color: accent)
        drawRoundedRect(CGRect(x: frame.maxX - 160, y: y + 12, width: 9, height: 3), fill: accent)
        drawText(comparison.priorYearText, x: frame.maxX - 56, y: y + 8, width: 42, height: 12, font: .boldSystemFont(ofSize: 8), color: secondaryAccent)
        drawRoundedRect(CGRect(x: frame.maxX - 70, y: y + 12, width: 9, height: 3), fill: secondaryAccent)

        let plot = CGRect(x: frame.minX + 42, y: y + 27, width: frame.width - 56, height: max(17, height - 43))
        drawLine(x: plot.minX, width: plot.width, y: plot.maxY)
        let maximum = max(
            comparison.months.flatMap {
                [NSDecimalNumber(decimal: $0.currentRunningSales).doubleValue, NSDecimalNumber(decimal: $0.priorYearRunningSales).doubleValue]
            }.max() ?? 1,
            1
        )
        drawText(shortCurrency(maximum), x: frame.minX + 6, y: plot.minY - 3, width: 32, height: 10, font: .systemFont(ofSize: 6), alignment: .right, color: mutedInk)

        let count = max(comparison.months.count, 1)
        let xPosition: (Int) -> CGFloat = { index in
            count == 1 ? plot.midX : plot.minX + CGFloat(index) * plot.width / CGFloat(count - 1)
        }
        let yPosition: (Decimal) -> CGFloat = { value in
            plot.maxY - CGFloat(NSDecimalNumber(decimal: value).doubleValue / maximum) * plot.height
        }

        drawChartLine(
            points: comparison.months.enumerated().map { CGPoint(x: xPosition($0.offset), y: yPosition($0.element.currentRunningSales)) },
            color: accent
        )
        drawChartLine(
            points: comparison.months.enumerated().map { CGPoint(x: xPosition($0.offset), y: yPosition($0.element.priorYearRunningSales)) },
            color: secondaryAccent
        )
        for (index, month) in comparison.months.enumerated() {
            drawText(String(month.monthName.prefix(3)), x: xPosition(index) - 14, y: plot.maxY + 5, width: 28, height: 9, font: .systemFont(ofSize: 6.2), alignment: .center, color: mutedInk)
        }
    }

    private static func drawSalesMixUnits(store: SalesStore, frame: CGRect) {
        let slices = store.selectedCustomerClassMix
        guard !slices.isEmpty else { return }

        let total = max(slices.reduce(0) { $0 + $1.units }, 1)
        let gap: CGFloat = 7
        let innerX = frame.minX + 10
        let innerWidth = frame.width - 20
        let pillWidth = (innerWidth - gap * 2) / 3
        let normalizedNames = ["Unisex", "Women's", "Youth"]
        let unitsByName = Dictionary(uniqueKeysWithValues: slices.map { ($0.name, $0.units) })

        drawRoundedRect(frame, fill: tableStripe)
        drawText("Sales Mix Units", x: innerX, y: frame.minY + 8, width: 110, height: 12, font: .boldSystemFont(ofSize: 8), color: mutedInk)

        for (index, name) in normalizedNames.enumerated() {
            let units = unitsByName[name] ?? 0
            let percent = Double(units) / Double(total)
            let x = innerX + CGFloat(index) * (pillWidth + gap)
            drawText(name, x: x, y: frame.minY + 23, width: pillWidth, height: 9, font: .boldSystemFont(ofSize: 6.7), color: mutedInk)
            drawText("\(units.formatted())", x: x, y: frame.minY + 33, width: pillWidth * 0.62, height: 10, font: .boldSystemFont(ofSize: 8), color: ink)
            drawText(percent.formatted(.percent.precision(.fractionLength(1))), x: x + pillWidth * 0.58, y: frame.minY + 33, width: pillWidth * 0.42, height: 10, font: .systemFont(ofSize: 6.5), alignment: .right, color: mutedInk)
            drawRoundedRect(CGRect(x: x, y: frame.minY + 45, width: pillWidth, height: 3), fill: barTrack)
            drawRoundedRect(CGRect(x: x, y: frame.minY + 45, width: max(2, pillWidth * CGFloat(percent)), height: 3), fill: salesMixColor(for: name))
        }
    }

    private static func drawMonthSalesChart(_ comparison: MonthComparison, currentTitle: String, priorTitle: String, frame: CGRect) {
        drawRoundedRect(frame, fill: tableStripe)
        drawText("Sales Comparison", x: frame.minX + 10, y: frame.minY + 8, width: 110, height: 12, font: .boldSystemFont(ofSize: 8), color: mutedInk)
        drawText(
            "\(comparison.directionText.capitalized) \(comparison.salesPercentChange.map { abs($0).percentageText } ?? "-")",
            x: frame.maxX - 104,
            y: frame.minY + 8,
            width: 98,
            height: 13,
            font: .boldSystemFont(ofSize: 9.5),
            alignment: .right,
            color: comparison.salesPercentChange.map { $0 >= 0 ? positive : negative } ?? mutedInk
        )

        let maximum = max(
            NSDecimalNumber(decimal: comparison.currentSales).doubleValue,
            NSDecimalNumber(decimal: comparison.priorYearSales).doubleValue,
            1
        )
        drawSalesBar(title: currentTitle, value: comparison.currentSales, maximum: maximum, x: frame.minX + 10, y: frame.minY + 25, width: frame.width - 20, color: accent)
        drawSalesBar(title: priorTitle, value: comparison.priorYearSales, maximum: maximum, x: frame.minX + 10, y: frame.minY + 39, width: frame.width - 20, color: secondaryAccent)
    }

    private static func drawSalesBar(title: String, value: Decimal, maximum: Double, x: CGFloat, y: CGFloat, width: CGFloat, color: NSColor) {
        let isCompact = width < 260
        let labelWidth: CGFloat = isCompact ? 54 : 90
        let valueWidth: CGFloat = isCompact ? 76 : 104
        let barX = x + labelWidth
        let barWidth = max(24, width - labelWidth - valueWidth - 10)
        drawText(title, x: x, y: y, width: labelWidth - 4, height: 11, font: .boldSystemFont(ofSize: isCompact ? 6.2 : 7), color: mutedInk)
        drawRoundedRect(CGRect(x: barX, y: y + 2, width: barWidth, height: isCompact ? 7 : 8), fill: barTrack)
        let amount = NSDecimalNumber(decimal: value).doubleValue
        drawRoundedRect(CGRect(x: barX, y: y + 2, width: max(2, barWidth * CGFloat(amount / maximum)), height: isCompact ? 7 : 8), fill: color)
        drawText(value.currencyText, x: x + width - valueWidth, y: y, width: valueWidth, height: 11, font: .boldSystemFont(ofSize: isCompact ? 6.5 : 8), alignment: .right)
    }

    private static func drawBestSalesDayWidget(store: SalesStore, frame: CGRect) {
        guard let summary = store.bestSalesDaySummary else { return }

        drawRoundedRect(frame, fill: tableStripe)
        drawText(summary.usesDailyTransactions ? "Best Sales Day" : "Top Items Sold", x: frame.minX + 10, y: frame.minY + 8, width: 95, height: 12, font: .boldSystemFont(ofSize: 8), color: mutedInk)
        let headline = summary.usesDailyTransactions
            ? "\(summary.date?.salesLensDateText ?? "-")  \(summary.sales.currencyText)"
            : store.selectedPeriodTitle
        drawText(headline, x: frame.maxX - 120, y: frame.minY + 8, width: 110, height: 12, font: .boldSystemFont(ofSize: 7), alignment: .right, color: ink)

        let maximum = max(summary.topItems.prefix(5).map { NSDecimalNumber(decimal: $0.sales).doubleValue }.max() ?? 1, 1)
        let labelWidth = frame.width * 0.42
        let detailWidth: CGFloat = 76
        let barX = frame.minX + 10 + labelWidth
        let barWidth = max(24, frame.width - labelWidth - detailWidth - 28)
        var rowY = frame.minY + 24
        for item in summary.topItems.prefix(5) {
            let label = "#\(item.rank) \(item.styleNumber)"
            drawText(label, x: frame.minX + 10, y: rowY, width: labelWidth - 5, height: 8, font: .boldSystemFont(ofSize: 5.8), color: ink)
            drawRoundedRect(CGRect(x: barX, y: rowY + 1, width: barWidth, height: 5), fill: barTrack)
            let value = NSDecimalNumber(decimal: item.sales).doubleValue
            drawRoundedRect(CGRect(x: barX, y: rowY + 1, width: max(2, barWidth * CGFloat(value / maximum)), height: 5), fill: accent)
            drawText("\(item.units) | \(item.sales.currencyText)", x: frame.maxX - detailWidth - 8, y: rowY - 1, width: detailWidth, height: 9, font: .boldSystemFont(ofSize: 5.4), alignment: .right, color: mutedInk)
            rowY += 7.2
        }
    }

    private static func drawSummaryReadouts(store: SalesStore, comparison: MonthComparison?, y: inout CGFloat) {
        let gap: CGFloat = 10
        let cardWidth = (pageSize.width - margin * 2 - gap * 3) / 4
        let cardHeight: CGFloat = 52

        if let ytd = store.yearToDateComparison {
            let direction = ytd.salesDifference >= 0 ? "Ahead" : "Behind"
            drawReadoutCard(
                title: "YTD Pace",
                value: "\(direction) \(ytd.salesPercentChange.map { abs($0).percentageText } ?? "-")",
                detail: ytd.salesDifference.signedCurrencyText,
                x: margin,
                y: y,
                width: cardWidth,
                height: cardHeight,
                color: ytd.salesDifference >= 0 ? positive : negative
            )
        }

        if let comparison {
            let monthDifference = comparison.currentSales - comparison.priorYearSales
            let direction = monthDifference >= 0 ? "Up" : "Down"
            drawReadoutCard(
                title: "Month Gap",
                value: "\(direction) \(comparison.salesPercentChange.map { abs($0).percentageText } ?? "-")",
                detail: monthDifference.signedCurrencyText,
                x: margin + cardWidth + gap,
                y: y,
                width: cardWidth,
                height: cardHeight,
                color: monthDifference >= 0 ? positive : negative
            )
        }

        let classTotal = max(store.selectedCustomerClassMix.reduce(0) { $0 + $1.units }, 1)
        if let topClass = store.selectedCustomerClassMix.max(by: { $0.units < $1.units }) {
            let percent = Double(topClass.units) / Double(classTotal)
            drawReadoutCard(
                title: "Mix Leader",
                value: topClass.name,
                detail: "\(topClass.units.formatted()) units | \(percent.formatted(.percent.precision(.fractionLength(1))))",
                x: margin + (cardWidth + gap) * 2,
                y: y,
                width: cardWidth,
                height: cardHeight,
                color: salesMixColor(for: topClass.name)
            )
        }

        if let bestDay = store.bestSalesDaySummary {
            let periodSales = max(NSDecimalNumber(decimal: store.selectedPeriodSales).doubleValue, 1)
            let share = NSDecimalNumber(decimal: bestDay.sales).doubleValue / periodSales
            drawReadoutCard(
                title: bestDay.usesDailyTransactions ? "Best Day Share" : "Top Item Share",
                value: share.formatted(.percent.precision(.fractionLength(1))),
                detail: "\(bestDay.sales.currencyText) of month",
                x: margin + (cardWidth + gap) * 3,
                y: y,
                width: cardWidth,
                height: cardHeight,
                color: accent
            )
        }

        y += cardHeight + 8
    }

    private static func drawReadoutCard(title: String, value: String, detail: String, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, color: NSColor) {
        drawRoundedRect(CGRect(x: x, y: y, width: width, height: height), fill: tableStripe)
        drawRoundedRect(CGRect(x: x, y: y, width: 4, height: height), fill: color)
        drawText(title, x: x + 10, y: y + 8, width: width - 20, height: 10, font: .boldSystemFont(ofSize: 7), color: mutedInk)
        drawText(value, x: x + 10, y: y + 21, width: width - 20, height: 14, font: .boldSystemFont(ofSize: 10), color: ink)
        drawText(detail, x: x + 10, y: y + 37, width: width - 20, height: 9, font: .systemFont(ofSize: 6.5), color: mutedInk)
    }

    private static func drawBestSalesDay(store: SalesStore, y: inout CGFloat, context: CGContext) {
        guard let summary = store.bestSalesDaySummary else { return }

        drawText(summary.usesDailyTransactions ? "Best Sales Day" : "Top 5 Items Sold", x: margin, y: y, width: 220, height: 17, font: .boldSystemFont(ofSize: 12.5), color: ink)
        drawRoundedRect(CGRect(x: margin, y: y + 18, width: 34, height: 2), fill: accent)
        y += 23

        let heading = summary.usesDailyTransactions
            ? "\(summary.date?.salesLensDateText ?? "-")  |  \(summary.sales.currencyText) sales  |  \(summary.units) units  |  \(summary.transactions) transactions"
            : "\(store.selectedPeriodTitle)  |  Monthly totals only; individual daily sales are not provided in the current Volshop file."
        drawText(heading, x: margin, y: y, width: pageSize.width - margin * 2, height: 10, font: .boldSystemFont(ofSize: 7), color: mutedInk)
        y += 12

        let maximum = max(summary.topItems.map { NSDecimalNumber(decimal: $0.sales).doubleValue }.max() ?? 1, 1)
        let labelWidth: CGFloat = 214
        let detailWidth: CGFloat = 126
        let trackWidth = pageSize.width - margin * 2 - labelWidth - detailWidth - 12
        let detailX = margin + labelWidth + trackWidth + 12
        for item in summary.topItems {
            drawText("#\(item.rank)  \(item.styleNumber)  \(item.artCode)  \(item.colorName)", x: margin, y: y + 1, width: labelWidth - 8, height: 9, font: .boldSystemFont(ofSize: 6.4), color: ink)
            drawRoundedRect(CGRect(x: margin + labelWidth, y: y + 2, width: trackWidth, height: 6), fill: barTrack)
            let value = NSDecimalNumber(decimal: item.sales).doubleValue
            drawRoundedRect(CGRect(x: margin + labelWidth, y: y + 2, width: max(2, trackWidth * CGFloat(value / maximum)), height: 6), fill: accent)
            drawText("\(item.units) units  |  \(item.sales.currencyText)", x: detailX, y: y, width: detailWidth, height: 9, font: .boldSystemFont(ofSize: 6.5), alignment: .right, color: mutedInk)
            y += 10
        }
    }

    private static func drawSalesMix(store: SalesStore, y: inout CGFloat) {
        guard let customer = store.salesMixCustomerName else { return }

        let slices = store.selectedCustomerClassMix
        let total = slices.reduce(0) { $0 + $1.units }
        guard total > 0 else { return }

        drawSectionTitle("\(customer) Sales Mix", y: &y)
        drawText("\(store.selectedPeriodTitle) units by Unisex, Women's, and Youth classification", x: margin, y: y, width: 560, height: 18, color: mutedInk)
        y += 30

        let chartCenter = CGPoint(x: margin + 148, y: y + 122)
        let radius: CGFloat = 105
        var startAngle = -CGFloat.pi / 2
        for slice in slices {
            let endAngle = startAngle + (CGFloat(slice.units) / CGFloat(total) * 2 * CGFloat.pi)
            drawPieSlice(
                center: chartCenter,
                radius: radius,
                startAngle: startAngle,
                endAngle: endAngle,
                color: salesMixColor(for: slice.name)
            )
            startAngle = endAngle
        }

        let legendX = margin + 304
        drawRoundedRect(
            CGRect(x: legendX, y: y + 28, width: 330, height: 185),
            fill: cardFill,
            stroke: cardStroke
        )
        drawText("Units Sold", x: legendX + 18, y: y + 46, width: 150, height: 16, font: .boldSystemFont(ofSize: 12))

        var legendY = y + 76
        for slice in slices {
            let percent = Double(slice.units) / Double(total)
            drawRoundedRect(CGRect(x: legendX + 18, y: legendY + 1, width: 11, height: 11), fill: salesMixColor(for: slice.name))
            drawText(slice.name, x: legendX + 42, y: legendY, width: 84, height: 16, font: .boldSystemFont(ofSize: 10))
            drawText("\(slice.units.formatted()) units", x: legendX + 132, y: legendY, width: 88, height: 16, font: .boldSystemFont(ofSize: 10), alignment: .right)
            drawText(percent.formatted(.percent.precision(.fractionLength(1))), x: legendX + 232, y: legendY, width: 68, height: 16, alignment: .right, color: mutedInk)
            legendY += 26
        }
        drawLine(x: legendX + 18, width: 282, y: legendY + 2)
        drawText("Total Sold", x: legendX + 42, y: legendY + 14, width: 90, height: 16, font: .boldSystemFont(ofSize: 10))
        drawText("\(total.formatted()) units", x: legendX + 132, y: legendY + 14, width: 168, height: 16, font: .boldSystemFont(ofSize: 11), alignment: .right)
        y += 265
    }

    private static func drawStyleSignals(store: SalesStore, y: inout CGFloat, context: CGContext) {
        guard !store.styleSignalGroups.isEmpty else { return }
        ensureSpace(120, store: store, y: &y, context: context)
        drawSectionTitle("Style Signals", y: &y)
        drawText("Ranked signals across the selected account, brand/class, and period. These are the places to protect, expand, or question.", x: margin, y: y, width: pageSize.width - margin * 2, height: 13, font: .systemFont(ofSize: 8), color: mutedInk)
        y += 20

        let cardWidth = pageSize.width - margin * 2
        let cardHeight: CGFloat = 134

        for (index, group) in store.styleSignalGroups.enumerated() {
            ensureSpace(cardHeight + 12, store: store, y: &y, context: context)
            if index > 0 {
                y += 8
            }
            drawStyleSignalCard(group, x: margin, y: y, width: cardWidth, height: cardHeight)
            y += cardHeight
        }

        y += 14
    }

    private static func drawTopStyleComparisons(store: SalesStore, y: inout CGFloat, context: CGContext) {
        ensureSpace(80, store: store, y: &y, context: context)
        drawSectionTitle("Top 10 Styles vs Last Year", y: &y)
        guard !store.topStyleMonthComparisons.isEmpty else {
            drawEmptyMessage("No matching prior-year style data for this period.", y: &y)
            return
        }

        let maxUnits = max(store.topStyleMonthComparisons.flatMap { [$0.currentUnits, $0.priorYearUnits] }.max() ?? 1, 1)
        let gap: CGFloat = 12
        let cardWidth = (pageSize.width - (margin * 2) - gap) / 2
        let cardHeight: CGFloat = 56

        for (index, style) in store.topStyleMonthComparisons.enumerated() {
            let column = index % 2
            if index > 0 && column == 0 {
                y += cardHeight + 8
            }
            ensureSpace(cardHeight + 10, store: store, y: &y, context: context)

            let x = margin + CGFloat(column) * (cardWidth + gap)
            drawStyleComparisonCard(style, maxUnits: maxUnits, x: x, y: y, width: cardWidth, height: cardHeight)
        }

        if !store.topStyleMonthComparisons.isEmpty {
            y += cardHeight + 14
        }
    }

    private static func drawTopSellers(store: SalesStore, productImages: [String: NSImage], y: inout CGFloat, context: CGContext) {
        guard store.selectedCustomer?.caseInsensitiveCompare("Rebel Rags") == .orderedSame else {
            drawTopSellersTable(store: store, y: &y, context: context)
            return
        }

        ensureSpace(80, store: store, y: &y, context: context)
        drawSectionTitle("Top 25 by Art", y: &y)
        drawText(store.selectedPeriodTitle, x: margin, y: y, width: 300, height: 14, color: mutedInk)
        y += 19

        guard !store.topSellers.isEmpty else {
            drawEmptyMessage("No art-level sales for this period.", y: &y)
            return
        }

        let columnGap: CGFloat = 8
        let rowGap: CGFloat = 6
        let cardsPerRow = 4
        let cardWidth = (pageSize.width - margin * 2 - columnGap * CGFloat(cardsPerRow - 1)) / CGFloat(cardsPerRow)
        let cardHeight: CGFloat = 124

        for (index, seller) in store.topSellers.enumerated() {
            let column = index % cardsPerRow
            if index > 0, column == 0 {
                y += cardHeight + rowGap
            }
            if y + cardHeight > pageSize.height - margin {
                startNewGalleryPage(store: store, y: &y, context: context)
                drawSectionTitle("Top 25 by Art (continued)", y: &y)
                drawText(store.selectedPeriodTitle, x: margin, y: y, width: 300, height: 14, color: mutedInk)
                y += 19
            }

            drawArtCard(
                seller,
                image: productImages[seller.id],
                x: margin + CGFloat(column) * (cardWidth + columnGap),
                y: y,
                width: cardWidth,
                height: cardHeight
            )
        }
        y += cardHeight + 10
    }

    private static func drawTopSellersTable(store: SalesStore, y: inout CGFloat, context: CGContext) {
        ensureSpace(80, store: store, y: &y, context: context)
        drawSectionTitle("Top 25 by Art", y: &y)
        let headers = ["#", "Art Code", "Style #", "Brand", "Style Name", "Color", "Period", "CY"]
        let widths: [CGFloat] = [22, 88, 62, 52, 218, 86, 90, 94]
        drawTableHeader(headers, widths: widths, y: &y)

        for seller in store.topSellers {
            if y + 20 > pageSize.height - margin {
                startNewPage(store: store, y: &y, context: context)
                drawSectionTitle("Top 25 by Art (continued)", y: &y)
                drawTableHeader(headers, widths: widths, y: &y)
            }

            drawTableRow(
                [
                    "\(seller.rank)",
                    seller.artCode,
                    seller.styleNumber,
                    seller.brandName,
                    seller.styleName,
                    seller.colorName,
                    "\(seller.units) | \(seller.sales.currencyText)",
                    "\(seller.currentYearUnits) | \(seller.currentYearSales.currencyText)"
                ],
                widths: widths,
                y: &y
            )
        }
    }

    private static func drawAllStyles(store: SalesStore, y: inout CGFloat, context: CGContext) {
        drawSectionTitle("All Styles Sold", y: &y)
        drawText("\(store.monthlyStylesByUnits.count) styles for \(store.selectedPeriodTitle)", x: margin, y: y, width: 420, height: 16, color: mutedInk)
        y += 24

        let headers = ["#", "Style #", "Brand", "Trans.", "Colors", "Art Description", "Units", "Sales"]
        let widths: [CGFloat] = [24, 70, 58, 48, 44, 292, 46, 84]
        drawTableHeader(headers, widths: widths, y: &y)

        for style in store.monthlyStylesByUnits {
            if y + 20 > pageSize.height - margin {
                startNewPage(store: store, y: &y, context: context)
                drawSectionTitle("All Styles Sold (continued)", y: &y)
                drawTableHeader(headers, widths: widths, y: &y)
            }

            drawTableRow(
                ["\(style.rank)", style.styleNumber, style.brandName, "\(style.rowCount)", "\(style.colorCount)", style.artDetails, "\(style.units)", style.sales.currencyText],
                widths: widths,
                y: &y
            )
        }
    }

    private static func ensureSpace(_ neededHeight: CGFloat, store: SalesStore, y: inout CGFloat, context: CGContext) {
        if y + neededHeight <= pageSize.height - margin {
            return
        }

        startNewPage(store: store, y: &y, context: context)
    }

    private static func startNewPage(store: SalesStore, y: inout CGFloat, context: CGContext) {
        context.endPDFPage()
        context.beginPDFPage(nil)
        drawPageBackground()
        y = margin
        drawHeader(store: store, y: &y, compact: true)
    }

    private static func startNewGalleryPage(store: SalesStore, y: inout CGFloat, context: CGContext) {
        context.endPDFPage()
        context.beginPDFPage(nil)
        drawPageBackground()
        y = margin
        drawText("LESTER SALES", x: margin, y: y, width: 180, height: 18, font: .boldSystemFont(ofSize: 13), color: accent)
        drawText("\(store.selectedCustomer ?? "All Customers")  |  \(store.selectedPeriodTitle)", x: pageSize.width - margin - 340, y: y + 2, width: 340, height: 16, font: .boldSystemFont(ofSize: 9), alignment: .right, color: mutedInk)
        y += 27
    }

    private static func drawSectionTitle(_ title: String, y: inout CGFloat) {
        drawText(title, x: margin, y: y, width: 400, height: 20, font: .boldSystemFont(ofSize: 14), color: ink)
        drawRoundedRect(CGRect(x: margin, y: y + 21, width: 34, height: 2), fill: accent)
        y += 26
    }

    private static func drawMetricCard(title: String, value: String, detail: String? = nil, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat = 62) {
        drawRoundedRect(CGRect(x: x, y: y, width: width, height: height), fill: tableStripe)
        drawRoundedRect(CGRect(x: x, y: y, width: 4, height: height), fill: accent)
        drawText(title, x: x + 10, y: y + 9, width: width - 20, height: 14, font: .systemFont(ofSize: 8), color: mutedInk)
        drawText(value, x: x + 10, y: y + 25, width: width - 20, height: 18, font: .boldSystemFont(ofSize: 12))
        if let detail {
            drawText(detail, x: x + 10, y: y + 40, width: width - 20, height: 10, font: .systemFont(ofSize: 8), color: mutedInk)
        }
    }

    private static func drawTableHeader(_ titles: [String], widths: [CGFloat], y: inout CGFloat) {
        drawRoundedRect(CGRect(x: margin, y: y, width: widths.reduce(0, +), height: 22), fill: headerFill)
        drawTableTexts(titles, widths: widths, y: y + 5, font: .boldSystemFont(ofSize: 7.5), color: .white)
        y += 24
    }

    private static func drawTableRow(_ values: [String], widths: [CGFloat], y: inout CGFloat) {
        if Int((y - margin) / 20).isMultiple(of: 2) {
            drawRoundedRect(CGRect(x: margin, y: y, width: widths.reduce(0, +), height: 20), fill: tableStripe)
        }
        drawTableTexts(values, widths: widths, y: y + 5, font: .systemFont(ofSize: 7.5), color: ink)
        drawLine(y: y + 19)
        y += 20
    }

    private static func drawTableTexts(_ values: [String], widths: [CGFloat], y: CGFloat, font: NSFont, color: NSColor) {
        var x = margin
        for (index, value) in values.enumerated() {
            drawText(value, x: x + 5, y: y, width: widths[index] - 10, height: 12, font: font, color: color)
            x += widths[index]
        }
    }

    private static func drawArtCard(_ seller: TopSeller, image: NSImage?, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
        drawRoundedRect(CGRect(x: x, y: y, width: width, height: height), fill: tableStripe)

        let imageRect = CGRect(x: x + 6, y: y + 5, width: width - 12, height: 74)
        if let image {
            drawImage(image, in: imageRect)
        } else {
            drawRoundedRect(imageRect, fill: tableStripe)
            drawText("No image", x: imageRect.minX, y: imageRect.midY - 5, width: imageRect.width, height: 10, font: .systemFont(ofSize: 7), alignment: .center, color: mutedInk)
        }

        drawRoundedRect(CGRect(x: x + 6, y: y + 6, width: 24, height: 13), fill: headerFill)
        drawText("#\(seller.rank)", x: x + 6, y: y + 9, width: 24, height: 9, font: .boldSystemFont(ofSize: 7), alignment: .center, color: .white)
        drawText(seller.styleNumber, x: x + 7, y: y + 83, width: width * 0.45, height: 11, font: .boldSystemFont(ofSize: 8))
        drawText(seller.artCode, x: x + width * 0.42, y: y + 83, width: width * 0.54 - 7, height: 11, font: .boldSystemFont(ofSize: 7.5), alignment: .right, color: accent)
        drawText(seller.colorName, x: x + 7, y: y + 97, width: width * 0.49, height: 10, font: .systemFont(ofSize: 7), color: mutedInk)
        drawText("\(seller.units) Units | \(seller.sales.currencyText)", x: x + width * 0.42, y: y + 97, width: width * 0.54 - 7, height: 10, font: .boldSystemFont(ofSize: 7), alignment: .right)
        drawText("CY: \(seller.currentYearUnits) Units | \(seller.currentYearSales.currencyText)", x: x + 7, y: y + 109, width: width - 14, height: 10, font: .boldSystemFont(ofSize: 6.6), alignment: .right, color: mutedInk)
    }

    private static func drawStyleComparisonCard(_ style: TopStyleMonthComparison, maxUnits: Int, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
        drawRoundedRect(CGRect(x: x, y: y, width: width, height: height), fill: tableStripe)
        drawRoundedRect(CGRect(x: x, y: y, width: 4, height: height), fill: accent)
        drawText("\(style.rank)", x: x + 10, y: y + 9, width: 22, height: 14, font: .boldSystemFont(ofSize: 9), color: mutedInk)
        drawText(style.styleNumber, x: x + 34, y: y + 7, width: 84, height: 16, font: .boldSystemFont(ofSize: 11))
        drawText(style.brandName, x: x + 118, y: y + 9, width: 74, height: 13, font: .boldSystemFont(ofSize: 7.5), color: mutedInk)
        drawText("\(style.currentUnits) vs \(style.priorYearUnits) units", x: x + width - 118, y: y + 7, width: 106, height: 14, font: .boldSystemFont(ofSize: 9), alignment: .right)

        drawAttributedText(scopeLine(for: style), x: x + 34, y: y + 22, width: width - 46, height: 12)
        drawComparisonBar(label: "CY", value: style.currentUnits, maxValue: maxUnits, x: x + 34, y: y + 36, width: width - 56, color: accent)
        drawComparisonBar(label: "LY", value: style.priorYearUnits, maxValue: maxUnits, x: x + 34, y: y + 47, width: width - 56, color: secondaryAccent)
    }

    private static func drawStyleSignalCard(_ group: StyleSignalGroup, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
        let signalColor = signalAccentColor(for: group.kind)
        drawRoundedRect(CGRect(x: x, y: y + 1, width: width, height: 3), fill: signalColor)
        drawText(group.kind.title, x: x, y: y + 10, width: width - 28, height: 14, font: .boldSystemFont(ofSize: 10), color: signalColor)
        drawText(group.kind.subtitle, x: x, y: y + 25, width: width - 28, height: 10, font: .systemFont(ofSize: 6.8), color: mutedInk)

        let tableY = y + 42
        let rankX = x
        let styleX = x + 16
        let brandX = x + 164
        let unitsX = x + 220
        let cyX = x + 306
        let lyX = x + 444
        let changeX = x + width - 104

        drawText("Style", x: styleX, y: tableY, width: 142, height: 9, font: .boldSystemFont(ofSize: 6.5), color: mutedInk)
        drawText("Brand", x: brandX, y: tableY, width: 48, height: 9, font: .boldSystemFont(ofSize: 6.5), color: mutedInk)
        drawText("Units", x: unitsX, y: tableY, width: 72, height: 9, font: .boldSystemFont(ofSize: 6.5), color: mutedInk)
        drawText("CY Breadth", x: cyX, y: tableY, width: 124, height: 9, font: .boldSystemFont(ofSize: 6.5), color: mutedInk)
        drawText("LY Breadth", x: lyX, y: tableY, width: 124, height: 9, font: .boldSystemFont(ofSize: 6.5), color: mutedInk)
        drawText("Sales Change", x: changeX, y: tableY, width: 88, height: 9, font: .boldSystemFont(ofSize: 6.5), alignment: .right, color: mutedInk)

        var rowY = y + 57
        for item in group.items {
            if item.rank.isMultiple(of: 2) {
                drawRoundedRect(CGRect(x: x, y: rowY - 2, width: width, height: 14), fill: tableStripe)
            }
            drawText("\(item.rank)", x: rankX, y: rowY, width: 12, height: 10, font: .boldSystemFont(ofSize: 6.8), color: mutedInk)
            drawText(item.styleNumber, x: styleX, y: rowY, width: 142, height: 10, font: .boldSystemFont(ofSize: 7.4), color: ink)
            drawText(item.brandName, x: brandX, y: rowY + 1, width: 48, height: 9, font: .boldSystemFont(ofSize: 5.8), color: mutedInk)
            drawText("\(item.currentUnits) vs \(item.priorYearUnits)", x: unitsX, y: rowY, width: 72, height: 10, font: .systemFont(ofSize: 7), color: mutedInk)
            drawAttributedText(signalBreadthLine(current: item.colorCount, previous: item.priorYearColorCount, art: item.artCount, previousArt: item.priorYearArtCount), x: cyX, y: rowY, width: 124, height: 10)
            drawAttributedText(signalBreadthLine(current: item.priorYearColorCount, previous: item.colorCount, art: item.priorYearArtCount, previousArt: item.artCount), x: lyX, y: rowY, width: 124, height: 10)
            drawText(signalPrimaryValue(for: item, kind: group.kind), x: changeX, y: rowY, width: 88, height: 10, font: .boldSystemFont(ofSize: 7.4), alignment: .right, color: signalColor)
            rowY += 15
        }
    }

    private static func signalAccentColor(for kind: StyleSignalKind) -> NSColor {
        switch kind {
        case .growthDrivers, .assortmentExpansion, .efficientWinners:
            return positive
        case .decliners, .assortmentContraction, .missingLastYearSellers:
            return negative
        }
    }

    private static func signalPrimaryValue(for item: StyleSignalItem, kind: StyleSignalKind) -> String {
        switch kind {
        case .missingLastYearSellers:
            return "LY \(item.priorYearSales.currencyText)"
        default:
            return item.salesChange.signedCurrencyText
        }
    }

    private static func drawComparisonBar(label: String, value: Int, maxValue: Int, x: CGFloat, y: CGFloat, width: CGFloat, color: NSColor) {
        drawText(label, x: x, y: y - 2, width: 18, height: 11, font: .boldSystemFont(ofSize: 7), color: mutedInk)
        let trackX = x + 22
        let trackWidth = width - 54
        drawRoundedRect(CGRect(x: trackX, y: y, width: trackWidth, height: 7), fill: barTrack)
        let barWidth = max(2, trackWidth * CGFloat(value) / CGFloat(max(maxValue, 1)))
        drawRoundedRect(CGRect(x: trackX, y: y, width: barWidth, height: 7), fill: color)
        drawText("\(value)", x: trackX + trackWidth + 6, y: y - 3, width: 26, height: 11, font: .systemFont(ofSize: 7), alignment: .right, color: mutedInk)
    }

    private static func drawChartLine(points: [CGPoint], color: NSColor) {
        guard let first = points.first else { return }

        let path = NSBezierPath()
        path.move(to: CGPoint(x: first.x, y: pageSize.height - first.y))
        for point in points.dropFirst() {
            path.line(to: CGPoint(x: point.x, y: pageSize.height - point.y))
        }
        color.setStroke()
        path.lineWidth = 2
        path.stroke()

        for point in points {
            let marker = CGRect(x: point.x - 2.5, y: pageSize.height - point.y - 2.5, width: 5, height: 5)
            color.setFill()
            NSBezierPath(ovalIn: marker).fill()
        }
    }

    private static func shortCurrency(_ value: Double) -> String {
        if value >= 1_000_000 {
            return "$\(String(format: "%.1f", value / 1_000_000))M"
        }
        if value >= 1_000 {
            return "$\(Int((value / 1_000).rounded()))k"
        }
        return "$\(Int(value.rounded()))"
    }

    private static func scopeLine(for style: TopStyleMonthComparison) -> NSAttributedString {
        let result = NSMutableAttributedString()
        append("CY: ", to: result, color: mutedInk)
        append(countText(style.colorCount, singular: "Color", plural: "Colors"), to: result, color: comparisonColor(current: style.colorCount, previous: style.priorYearColorCount))
        append(", ", to: result, color: mutedInk)
        append(countText(style.artCount, singular: "Artwork", plural: "Artworks"), to: result, color: comparisonColor(current: style.artCount, previous: style.priorYearArtCount))
        append(" | LY: ", to: result, color: mutedInk)
        append(countText(style.priorYearColorCount, singular: "Color", plural: "Colors"), to: result, color: comparisonColor(current: style.priorYearColorCount, previous: style.colorCount))
        append(", ", to: result, color: mutedInk)
        append(countText(style.priorYearArtCount, singular: "Artwork", plural: "Artworks"), to: result, color: comparisonColor(current: style.priorYearArtCount, previous: style.artCount))
        return result
    }

    private static func signalScopeLine(for item: StyleSignalItem) -> NSAttributedString {
        let result = NSMutableAttributedString()
        append("CY: ", to: result, color: mutedInk)
        append(countText(item.colorCount, singular: "Color", plural: "Colors"), to: result, color: comparisonColor(current: item.colorCount, previous: item.priorYearColorCount))
        append(", ", to: result, color: mutedInk)
        append(countText(item.artCount, singular: "Artwork", plural: "Artworks"), to: result, color: comparisonColor(current: item.artCount, previous: item.priorYearArtCount))
        append(" | LY: ", to: result, color: mutedInk)
        append(countText(item.priorYearColorCount, singular: "Color", plural: "Colors"), to: result, color: comparisonColor(current: item.priorYearColorCount, previous: item.colorCount))
        append(", ", to: result, color: mutedInk)
        append(countText(item.priorYearArtCount, singular: "Artwork", plural: "Artworks"), to: result, color: comparisonColor(current: item.priorYearArtCount, previous: item.artCount))
        return result
    }

    private static func signalBreadthLine(current: Int, previous: Int, art: Int, previousArt: Int) -> NSAttributedString {
        let result = NSMutableAttributedString()
        append(countText(current, singular: "Color", plural: "Colors"), to: result, color: comparisonColor(current: current, previous: previous))
        append(", ", to: result, color: mutedInk)
        append(countText(art, singular: "Artwork", plural: "Artworks"), to: result, color: comparisonColor(current: art, previous: previousArt))
        return result
    }

    private static func countText(_ count: Int, singular: String, plural: String) -> String {
        "\(count) \(count == 1 ? singular : plural)"
    }

    private static func append(_ string: String, to attributed: NSMutableAttributedString, color: NSColor) {
        attributed.append(NSAttributedString(
            string: string,
            attributes: [
                .font: NSFont.systemFont(ofSize: 7.5),
                .foregroundColor: color
            ]
        ))
    }

    private static func comparisonColor(current: Int, previous: Int) -> NSColor {
        if current > previous {
            return positive
        } else if current < previous {
            return negative
        } else {
            return mutedInk
        }
    }

    private static func salesMixColor(for audience: String) -> NSColor {
        switch audience {
        case "Unisex":
            return accent
        case "Women's":
            return secondaryAccent
        default:
            return theme.tertiaryAccent
        }
    }

    private static func drawEmptyMessage(_ message: String, y: inout CGFloat) {
        drawText(message, x: margin, y: y, width: pageSize.width - margin * 2, height: 20, font: .systemFont(ofSize: 10), color: mutedInk)
        y += 30
    }

    private static func drawText(
        _ text: String,
        x: CGFloat,
        y: CGFloat,
        width: CGFloat,
        height: CGFloat,
        font: NSFont = .systemFont(ofSize: 10),
        alignment: NSTextAlignment = .left,
        color: NSColor? = nil
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color ?? ink,
            .paragraphStyle: paragraph
        ]
        let rect = CGRect(x: x, y: pageSize.height - y - height, width: width, height: height)
        (text as NSString).draw(in: rect, withAttributes: attributes)
    }

    private static func drawAttributedText(_ text: NSAttributedString, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
        let rect = CGRect(x: x, y: pageSize.height - y - height, width: width, height: height)
        text.draw(in: rect)
    }

    private static func drawLogo(x: CGFloat, y: CGFloat) {
        drawRoundedRect(CGRect(x: x, y: y, width: 42, height: 42), fill: headerFill)
        drawRoundedRect(CGRect(x: x + 6, y: y + 31, width: 30, height: 4), fill: secondaryAccent)
        drawText("LS", x: x, y: y + 9, width: 42, height: 18, font: .boldSystemFont(ofSize: 16), alignment: .center, color: .white)
        drawText("LESTER", x: x + 50, y: y + 7, width: 62, height: 13, font: .boldSystemFont(ofSize: 10), color: ink)
        drawText("SALES", x: x + 50, y: y + 21, width: 62, height: 13, font: .boldSystemFont(ofSize: 10), color: accent)
    }

    private static func drawSignatureBlock(x: CGFloat, y: CGFloat) {
        drawText("Ryan Lester", x: x, y: y, width: 112, height: 10, font: .boldSystemFont(ofSize: 7.2), color: ink)
        drawText("Independent Sales Rep", x: x, y: y + 9, width: 112, height: 9, font: .systemFont(ofSize: 6.2), color: mutedInk)
        drawText("P: (502) 689-7374", x: x, y: y + 20, width: 112, height: 8, font: .systemFont(ofSize: 5.8), color: mutedInk)
        drawText("E: ryanlestersells@gmail.com", x: x, y: y + 28, width: 112, height: 8, font: .systemFont(ofSize: 5.8), color: mutedInk)
        drawText("W: lestersales.net", x: x, y: y + 36, width: 112, height: 8, font: .systemFont(ofSize: 5.8), color: mutedInk)
    }

    private static func drawPageBackground() {
        drawRect(CGRect(origin: .zero, size: pageSize), fill: pageFill)
    }

    private static func drawPieSlice(center: CGPoint, radius: CGFloat, startAngle: CGFloat, endAngle: CGFloat, color: NSColor) {
        let flippedCenter = CGPoint(x: center.x, y: pageSize.height - center.y)
        let degrees = { (angle: CGFloat) in angle * 180 / CGFloat.pi }
        let path = NSBezierPath()
        path.move(to: flippedCenter)
        path.appendArc(
            withCenter: flippedCenter,
            radius: radius,
            startAngle: -degrees(endAngle),
            endAngle: -degrees(startAngle),
            clockwise: false
        )
        path.close()
        color.setFill()
        path.fill()
        NSColor.white.setStroke()
        path.lineWidth = 2
        path.stroke()
    }

    private static func drawImage(_ image: NSImage, in rect: CGRect) {
        let targetRect = CGRect(x: rect.minX, y: pageSize.height - rect.maxY, width: rect.width, height: rect.height)
        let imageSize = image.size
        guard imageSize.width > 0, imageSize.height > 0 else { return }

        let scale = min(targetRect.width / imageSize.width, targetRect.height / imageSize.height)
        let drawSize = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        let drawRect = CGRect(
            x: targetRect.midX - drawSize.width / 2,
            y: targetRect.midY - drawSize.height / 2,
            width: drawSize.width,
            height: drawSize.height
        )
        image.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1)
    }

    private static func drawRoundedRect(_ rect: CGRect, fill: NSColor, stroke: NSColor? = nil) {
        let flipped = CGRect(x: rect.minX, y: pageSize.height - rect.maxY, width: rect.width, height: rect.height)
        let path = NSBezierPath(roundedRect: flipped, xRadius: 6, yRadius: 6)
        fill.setFill()
        path.fill()
        if let stroke {
            stroke.setStroke()
            path.lineWidth = 0.6
            path.stroke()
        }
    }

    private static func drawRect(_ rect: CGRect, fill: NSColor) {
        let flipped = CGRect(x: rect.minX, y: pageSize.height - rect.maxY, width: rect.width, height: rect.height)
        fill.setFill()
        NSBezierPath(rect: flipped).fill()
    }

    private static func drawLine(y: CGFloat) {
        drawLine(x: margin, width: pageSize.width - margin * 2, y: y)
    }

    private static func drawLine(x: CGFloat, width: CGFloat, y: CGFloat) {
        let path = NSBezierPath()
        rule.setStroke()
        path.move(to: CGPoint(x: x, y: pageSize.height - y))
        path.line(to: CGPoint(x: x + width, y: pageSize.height - y))
        path.lineWidth = 0.5
        path.stroke()
    }

    private struct PDFTheme {
        let pageFill: NSColor
        let ink: NSColor
        let mutedInk: NSColor
        let cardFill: NSColor
        let cardStroke: NSColor
        let headerFill: NSColor
        let tableStripe: NSColor
        let barTrack: NSColor
        let rule: NSColor
        let accent: NSColor
        let secondaryAccent: NSColor
        let tertiaryAccent: NSColor
        let positive: NSColor
        let negative: NSColor

        static let neutral = PDFTheme(
            pageFill: NSColor(red: 0.945, green: 0.957, blue: 0.973, alpha: 1),
            ink: NSColor(red: 0.063, green: 0.102, blue: 0.176, alpha: 1),
            mutedInk: NSColor(red: 0.369, green: 0.424, blue: 0.510, alpha: 1),
            cardFill: .white,
            cardStroke: NSColor(red: 0.816, green: 0.847, blue: 0.894, alpha: 1),
            headerFill: NSColor(red: 0.024, green: 0.125, blue: 0.263, alpha: 1),
            tableStripe: NSColor(red: 0.910, green: 0.941, blue: 0.984, alpha: 1),
            barTrack: NSColor(red: 0.831, green: 0.875, blue: 0.941, alpha: 1),
            rule: NSColor(red: 0.796, green: 0.827, blue: 0.878, alpha: 1),
            accent: NSColor(red: 0.000, green: 0.376, blue: 0.792, alpha: 1),
            secondaryAccent: NSColor(red: 0.922, green: 0.463, blue: 0.000, alpha: 1),
            tertiaryAccent: NSColor(red: 0.000, green: 0.541, blue: 0.322, alpha: 1),
            positive: NSColor(red: 0.000, green: 0.541, blue: 0.322, alpha: 1),
            negative: NSColor(red: 0.816, green: 0.184, blue: 0.184, alpha: 1)
        )

        static let volshop: PDFTheme = {
            let orange = NSColor(red: 1.000, green: 0.510, blue: 0.000, alpha: 1)
            let black = NSColor(red: 0.080, green: 0.080, blue: 0.080, alpha: 1)
            return PDFTheme(
                pageFill: .white,
                ink: black,
                mutedInk: NSColor(red: 0.320, green: 0.320, blue: 0.320, alpha: 1),
                cardFill: .white,
                cardStroke: orange.withAlphaComponent(0.38),
                headerFill: black,
                tableStripe: orange.withAlphaComponent(0.10),
                barTrack: orange.withAlphaComponent(0.16),
                rule: orange.withAlphaComponent(0.34),
                accent: orange,
                secondaryAccent: black,
                tertiaryAccent: orange.withAlphaComponent(0.48),
                positive: orange,
                negative: black
            )
        }()

        static let rebelRags: PDFTheme = {
            let red = NSColor(red: 0.784, green: 0.063, blue: 0.180, alpha: 1)
            let lightBlue = NSColor(red: 0.000, green: 0.639, blue: 0.878, alpha: 1)
            return PDFTheme(
                pageFill: .white,
                ink: NSColor(red: 0.102, green: 0.118, blue: 0.145, alpha: 1),
                mutedInk: NSColor(red: 0.350, green: 0.392, blue: 0.450, alpha: 1),
                cardFill: .white,
                cardStroke: lightBlue.withAlphaComponent(0.40),
                headerFill: red,
                tableStripe: lightBlue.withAlphaComponent(0.10),
                barTrack: lightBlue.withAlphaComponent(0.18),
                rule: lightBlue.withAlphaComponent(0.34),
                accent: red,
                secondaryAccent: lightBlue,
                tertiaryAccent: red.withAlphaComponent(0.46),
                positive: lightBlue,
                negative: red
            )
        }()

        static func forCustomer(_ customer: String?) -> PDFTheme {
            switch customer?.lowercased() {
            case "volshop":
                return .volshop
            case "rebel rags":
                return .rebelRags
            default:
                return .neutral
            }
        }
    }
}

private func importSummaryMessage(_ summary: ImportSummary) -> String {
    let salesMonth = summary.salesMonth?.salesLensLongMonthText ?? "Unknown sales month"
    let received = summary.receivedDate?.salesLensDateText ?? "unknown received date"
    return "\(summary.status.rawValue): \(summary.fileName)\nSales month: \(salesMonth)\nReceived: \(received)\nImported: \(summary.importedCount) rows\nSkipped: \(summary.skippedCount) rows\n\n\(summary.message)"
}

private extension UTType {
    static let salesLensExcelXML = UTType(filenameExtension: "xls") ?? .data
    static let salesLensXLSX = UTType(filenameExtension: "xlsx") ?? .data
}

private struct SidebarView: View {
    @EnvironmentObject private var store: SalesStore
    @State private var isAddingAccount = false
    @State private var newAccountName = ""

    var body: some View {
        List(selection: Binding(
            get: { store.selectedCustomer ?? "all" },
            set: { store.selectedCustomer = $0 == "all" ? nil : $0 }
        )) {
            Section("Customers") {
                Label("All Customers", systemImage: "person.3")
                    .tag("all")

                ForEach(store.customers, id: \.self) { customer in
                    Label(customer, systemImage: "building.2")
                        .tag(customer)
                }

                Button {
                    newAccountName = ""
                    isAddingAccount = true
                } label: {
                    Label("Add Account", systemImage: "plus.circle")
                }
            }
        }
        .navigationTitle("SalesLens")
        .alert("Add Account", isPresented: $isAddingAccount) {
            TextField("Account name", text: $newAccountName)
            Button("Add") {
                store.addAccount(named: newAccountName)
                newAccountName = ""
            }
            Button("Cancel", role: .cancel) {
                newAccountName = ""
            }
        } message: {
            Text("Create a sidebar account before uploading its monthly POS files.")
        }
        .safeAreaInset(edge: .bottom) {
            VStack(alignment: .leading, spacing: 6) {
                Text("\(store.records.count) records")
                    .font(.callout.weight(.semibold))
                Text("\(store.customers.count) customers")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(.bar)
        }
    }
}

private struct ImportAccountSelectionView: View {
    @EnvironmentObject private var store: SalesStore
    let urls: [URL]
    @Binding var isPresented: Bool
    let onImport: (String) -> Void
    @State private var selectedAccount = ""
    @State private var newAccountName = ""

    var accountChoices: [String] {
        store.customers
    }

    var selectedAccountName: String {
        if selectedAccount == "__new" {
            return newAccountName.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return selectedAccount
    }

    var canImport: Bool {
        !selectedAccountName.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Choose Account")
                    .font(.title2.weight(.semibold))
                Text(importDescription)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Picker("Account", selection: $selectedAccount) {
                ForEach(accountChoices, id: \.self) { account in
                    Text(account).tag(account)
                }
                Text("New Account...").tag("__new")
            }
            .pickerStyle(.menu)
            .frame(maxWidth: 360, alignment: .leading)

            if selectedAccount == "__new" {
                TextField("New account name", text: $newAccountName)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 360)
            }

            VStack(alignment: .leading, spacing: 6) {
                ForEach(urls, id: \.self) { url in
                    Label(url.lastPathComponent, systemImage: "doc")
                        .font(.callout)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))

            HStack {
                Spacer()
                Button("Cancel") {
                    isPresented = false
                }
                Button("Import") {
                    let account = selectedAccountName
                    if selectedAccount == "__new" {
                        store.addAccount(named: account)
                    }
                    onImport(account)
                    isPresented = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canImport)
            }
        }
        .padding(24)
        .frame(minWidth: 520)
        .onAppear {
            selectedAccount = store.selectedCustomer ?? accountChoices.first ?? "Volshop"
        }
    }

    private var importDescription: String {
        if urls.count == 1 {
            return "File this upload under the account it belongs to."
        }

        return "File these \(urls.count) uploads under the same account."
    }
}

private struct UploadManagementView: View {
    @EnvironmentObject private var store: SalesStore
    @Binding var isImporting: Bool
    @Binding var isConfirmingClear: Bool
    @Binding var isPresented: Bool
    @State private var selectedUploadIDs = Set<String>()

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Uploads")
                        .font(.title2.weight(.semibold))
                    Text("\(store.importBatches.count) uploaded monthly files")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    isPresented = false
                } label: {
                    Label("Done", systemImage: "xmark.circle")
                }

                Button {
                    isImporting = true
                } label: {
                    Label("Import", systemImage: "square.and.arrow.down")
                }

                Button(role: .destructive) {
                    store.deleteImportBatches(ids: selectedUploadIDs)
                    selectedUploadIDs.removeAll()
                } label: {
                    Label("Delete Selected", systemImage: "trash")
                }
                .disabled(selectedUploadIDs.isEmpty)

                Button(role: .destructive) {
                    isConfirmingClear = true
                } label: {
                    Label("Clear All", systemImage: "trash.slash")
                }
                .disabled(store.records.isEmpty)
            }

            Table(store.importBatches, selection: $selectedUploadIDs) {
                TableColumn("Sales Month") { batch in
                    Text(batch.salesMonth.salesLensMonthText)
                }
                .width(min: 120, ideal: 150)

                TableColumn("Received") { batch in
                    Text(batch.receivedDate?.salesLensDateText ?? "-")
                }
                .width(min: 110, ideal: 130)

                TableColumn("Customer") { batch in
                    Text(batch.customerName)
                }
                .width(min: 120, ideal: 150)

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
            .frame(minHeight: 420)
        }
        .padding(24)
        .frame(minWidth: 980, minHeight: 560)
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

private extension Double {
    var percentageText: String {
        DisplayFormatters.percent.string(from: NSNumber(value: self / 100)) ?? "\(self)%"
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
