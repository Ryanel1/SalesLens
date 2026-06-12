import Foundation

struct ParsedStyleIdentifier {
    let styleNumber: String?
    let colorCode: String?
    let artCode: String?
}

enum StyleIdentifierParser {
    static func parse(_ rawValue: String) -> ParsedStyleIdentifier {
        let cleaned = rawValue
            .replacingOccurrences(of: "\u{00a0}", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !cleaned.isEmpty else {
            return ParsedStyleIdentifier(styleNumber: nil, colorCode: nil, artCode: nil)
        }

        guard let artRange = artRange(in: cleaned) else {
            let split = splitStyleAndColor(cleaned)
            return ParsedStyleIdentifier(
                styleNumber: split.styleNumber ?? cleaned.trimmedStyleComponent.nilIfEmpty,
                colorCode: split.colorCode,
                artCode: nil
            )
        }

        let artCode = String(cleaned[artRange.lowerBound...])
            .trimmingCharacters(in: CharacterSet(charactersIn: "- /"))
        let prefix = String(cleaned[..<artRange.lowerBound])
            .trimmingCharacters(in: CharacterSet(charactersIn: "- /"))

        let split = splitStyleAndColor(prefix)
        return ParsedStyleIdentifier(
            styleNumber: split.styleNumber,
            colorCode: split.colorCode,
            artCode: artCode
        )
    }

    private static func artRange(in value: String) -> Range<String.Index>? {
        let markers = ["APC", "APO", "AEC", "AE", "AP"]
        return markers
            .compactMap { value.range(of: $0, options: [.caseInsensitive]) }
            .sorted {
                if $0.lowerBound == $1.lowerBound {
                    return value.distance(from: $0.lowerBound, to: $0.upperBound) > value.distance(from: $1.lowerBound, to: $1.upperBound)
                }
                return $0.lowerBound < $1.lowerBound
            }
            .first
    }

    private static func splitStyleAndColor(_ prefix: String) -> (styleNumber: String?, colorCode: String?) {
        guard !prefix.isEmpty else {
            return (nil, nil)
        }

        if let colorCode = knownColorSuffix(in: prefix) {
            let styleEnd = prefix.index(prefix.endIndex, offsetBy: -colorCode.count)
            let style = String(prefix[..<styleEnd]).trimmedStyleComponent
            return (style.nilIfEmpty, colorCode)
        }

        if let separator = prefix.lastIndex(of: "-") {
            let style = String(prefix[..<separator]).trimmedStyleComponent
            let color = String(prefix[prefix.index(after: separator)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            return (style.nilIfEmpty, color.nilIfEmpty)
        }

        if let range = prefix.range(of: #"[A-Z]\d{2}[A-Z]$"#, options: [.regularExpression]) {
            let style = String(prefix[..<range.lowerBound]).trimmedStyleComponent
            let color = String(prefix[range])
            return (style.nilIfEmpty, color.nilIfEmpty)
        }

        if prefix.count > 3 {
            let colorStart = prefix.index(prefix.endIndex, offsetBy: -3)
            let style = String(prefix[..<colorStart]).trimmedStyleComponent
            let color = String(prefix[colorStart...])
            return (style.nilIfEmpty, color.nilIfEmpty)
        }

        return (prefix, nil)
    }

    private static func knownColorSuffix(in prefix: String) -> String? {
        let normalizedPrefix = prefix.trimmedStyleComponent
        return ProductCatalog.knownColorCodes
            .filter { normalizedPrefix.hasSuffix($0) && normalizedPrefix.count > $0.count }
            .sorted { $0.count > $1.count }
            .first
    }
}

private extension String {
    var trimmedStyleComponent: String {
        trimmingCharacters(in: CharacterSet(charactersIn: "- /"))
    }

    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
