import Foundation

enum XLSXWorkbookReader {
    static func read(url: URL) throws -> XLSXWorkbook {
        let extractionURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("SalesLens-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: extractionURL, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: extractionURL) }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = ["-qq", url.path, "-d", extractionURL.path]
        try process.run()
        process.waitUntilExit()

        guard process.terminationStatus == 0 else {
            throw CSVImportError.unreadableFile
        }

        let sharedStrings = try readSharedStrings(from: extractionURL)
        let sheetNames = readSheetNames(from: extractionURL)
        let worksheetDirectory = extractionURL.appendingPathComponent("xl/worksheets", isDirectory: true)
        let worksheetURLs = try FileManager.default.contentsOfDirectory(
            at: worksheetDirectory,
            includingPropertiesForKeys: nil
        )
        .filter { $0.pathExtension == "xml" }
        .sorted { $0.lastPathComponent < $1.lastPathComponent }

        let sheets = try worksheetURLs.enumerated().map { index, sheetURL in
            let name = index < sheetNames.count ? sheetNames[index] : sheetURL.deletingPathExtension().lastPathComponent
            return XLSXSheet(name: name, rows: try readSheetRows(from: sheetURL, sharedStrings: sharedStrings))
        }

        return XLSXWorkbook(sheets: sheets)
    }

    private static func readSharedStrings(from extractionURL: URL) throws -> [String] {
        let url = extractionURL.appendingPathComponent("xl/sharedStrings.xml")
        guard FileManager.default.fileExists(atPath: url.path) else {
            return []
        }

        let parser = SharedStringsParser()
        let xmlParser = XMLParser(data: try Data(contentsOf: url))
        xmlParser.delegate = parser
        guard xmlParser.parse() else {
            throw CSVImportError.unreadableFile
        }
        return parser.values
    }

    private static func readSheetNames(from extractionURL: URL) -> [String] {
        let url = extractionURL.appendingPathComponent("xl/workbook.xml")
        guard let data = try? Data(contentsOf: url) else {
            return []
        }

        let parser = WorkbookNamesParser()
        let xmlParser = XMLParser(data: data)
        xmlParser.delegate = parser
        _ = xmlParser.parse()
        return parser.names
    }

    private static func readSheetRows(from url: URL, sharedStrings: [String]) throws -> [[String]] {
        let parser = WorksheetParser(sharedStrings: sharedStrings)
        let xmlParser = XMLParser(data: try Data(contentsOf: url))
        xmlParser.delegate = parser
        guard xmlParser.parse() else {
            throw CSVImportError.unreadableFile
        }
        return parser.rows
    }
}

struct XLSXWorkbook {
    let sheets: [XLSXSheet]
}

struct XLSXSheet {
    let name: String
    let rows: [[String]]
}

private final class WorkbookNamesParser: NSObject, XMLParserDelegate {
    private(set) var names: [String] = []

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        if elementName == "sheet", let name = attributeDict["name"] {
            names.append(name)
        }
    }
}

private final class SharedStringsParser: NSObject, XMLParserDelegate {
    private(set) var values: [String] = []
    private var activeText = ""
    private var isInsideText = false

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        if elementName == "si" {
            activeText = ""
        } else if elementName == "t" {
            isInsideText = true
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if isInsideText {
            activeText += string
        }
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        if elementName == "t" {
            isInsideText = false
        } else if elementName == "si" {
            values.append(activeText)
        }
    }
}

private final class WorksheetParser: NSObject, XMLParserDelegate {
    private let sharedStrings: [String]
    private(set) var rows: [[String]] = []
    private var activeRow: [String] = []
    private var activeColumn = 1
    private var activeCellType: String?
    private var activeCellValue = ""
    private var isInsideValue = false
    private var isInsideInlineText = false

    init(sharedStrings: [String]) {
        self.sharedStrings = sharedStrings
    }

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        switch elementName {
        case "row":
            activeRow = []
            activeColumn = 1
        case "c":
            if let reference = attributeDict["r"] {
                let explicitColumn = columnNumber(from: reference)
                while activeColumn < explicitColumn {
                    activeRow.append("")
                    activeColumn += 1
                }
            }
            activeCellType = attributeDict["t"]
            activeCellValue = ""
        case "v":
            isInsideValue = true
        case "t":
            isInsideInlineText = true
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if isInsideValue || isInsideInlineText {
            activeCellValue += string
        }
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        switch elementName {
        case "v":
            isInsideValue = false
        case "t":
            isInsideInlineText = false
        case "c":
            activeRow.append(resolvedValue())
            activeColumn += 1
        case "row":
            if activeRow.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
                rows.append(activeRow)
            }
        default:
            break
        }
    }

    private func resolvedValue() -> String {
        if activeCellType == "s",
           let index = Int(activeCellValue),
           sharedStrings.indices.contains(index) {
            return sharedStrings[index]
        }

        return activeCellValue
    }

    private func columnNumber(from reference: String) -> Int {
        var result = 0
        for character in reference.uppercased() where character.isLetter {
            let value = Int(character.asciiValue ?? 64) - 64
            result = (result * 26) + value
        }
        return max(result, 1)
    }
}
