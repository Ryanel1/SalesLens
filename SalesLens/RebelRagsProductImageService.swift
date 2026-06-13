import AppKit
import Foundation

actor RebelRagsProductImageService {
    static let shared = RebelRagsProductImageService()

    private let cacheDirectory: URL
    private let associationsURL: URL
    private var memoryCache: [String: NSImage] = [:]
    private var attemptedKeys: Set<String> = []
    private var associations: [String: ProductImageAssociation] = [:]

    private init() {
        let supportDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        cacheDirectory = supportDirectory
            .appendingPathComponent("SalesLens", isDirectory: true)
            .appendingPathComponent("ProductImages", isDirectory: true)
        associationsURL = cacheDirectory.appendingPathComponent("associations.json")
        try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: associationsURL),
           let loadedAssociations = try? JSONDecoder().decode([String: ProductImageAssociation].self, from: data) {
            associations = loadedAssociations
        }
    }

    func images(for sellers: [TopSeller], customerName: String?, retryMissing: Bool = false) async -> [String: NSImage] {
        guard isRebelRags(customerName) else { return [:] }

        var results: [String: NSImage] = [:]
        for seller in sellers {
            if let image = await image(for: seller, customerName: customerName, retryMissing: retryMissing) {
                results[seller.id] = image
            }
        }
        return results
    }

    func image(for seller: TopSeller, customerName: String?, retryMissing: Bool = false) async -> NSImage? {
        guard isRebelRags(customerName),
              seller.artCode != "-",
              seller.styleNumber != "-" else {
            return nil
        }

        let key = cacheKey(for: seller)
        let cacheURL = cacheDirectory.appendingPathComponent("\(key).image")
        let lookup = imageLookup(for: seller)

        if let association = associations[key],
           shouldInvalidateAssociation(association, for: seller, lookup: lookup) {
            memoryCache.removeValue(forKey: key)
            try? FileManager.default.removeItem(at: cacheURL)
            associations.removeValue(forKey: key)
            persistAssociations()
        }

        if let image = memoryCache[key] {
            return image
        }

        if let image = NSImage(contentsOf: cacheURL) {
            memoryCache[key] = image
            return image
        }

        if let association = associations[key],
           let imageURL = URL(string: association.imageURL),
           let localImage = try? await downloadImage(from: imageURL, to: cacheURL) {
            memoryCache[key] = localImage
            return localImage
        }

        guard retryMissing || !attemptedKeys.contains(key) else { return nil }
        attemptedKeys.insert(key)

        do {
            guard let match = try await matchingImageMatch(for: seller, lookup: lookup),
                  let image = try? await downloadImage(from: match.imageURL, to: cacheURL) else {
                return nil
            }
            memoryCache[key] = image
            associations[key] = ProductImageAssociation(
                styleNumber: seller.styleNumber,
                artCode: seller.artCode,
                colorName: seller.colorName,
                productURL: match.productURL.absoluteString,
                imageURL: match.imageURL.absoluteString,
                localFileName: cacheURL.lastPathComponent,
                matchedAt: Date(),
                lookupArtCode: lookup.searchArtCode
            )
            persistAssociations()
            return image
        } catch {
            return nil
        }
    }

    private func matchingImageMatch(for seller: TopSeller, lookup: ProductImageLookup) async throws -> ProductImageMatch? {
        if let productURL = lookup.productURL {
            let (detailData, _) = try await fetch(productURL)
            guard let detailHTML = String(data: detailData, encoding: .utf8),
                  let imageURL = productImageURL(in: detailHTML, for: seller, relativeTo: productURL) else {
                return nil
            }
            return ProductImageMatch(productURL: productURL, imageURL: imageURL)
        }

        guard let encodedArtCode = lookup.searchArtCode.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let searchURL = URL(string: "https://www.rebelrags.net/all-products/browse/keyword/\(encodedArtCode)") else {
            return nil
        }

        let (searchData, _) = try await fetch(searchURL)
        guard let searchHTML = String(data: searchData, encoding: .utf8) else { return nil }

        let productURLs = productDetailURLs(in: searchHTML)
        for productURL in productURLs.prefix(50) {
            let (detailData, _) = try await fetch(productURL)
            guard let detailHTML = String(data: detailData, encoding: .utf8),
                  detailMatches(detailHTML, seller: seller, lookupArtCode: lookup.searchArtCode),
                  let imageURL = productImageURL(in: detailHTML, for: seller, relativeTo: productURL) else {
                continue
            }
            return ProductImageMatch(productURL: productURL, imageURL: imageURL)
        }
        return nil
    }

    private func productDetailURLs(in html: String) -> [URL] {
        let pattern = #"href\s*=\s*["']((?:https?://www\.rebelrags\.net)?/[^"']+-[0-9]+/?(?:\?[^"']*)?)["']"#
        var uniqueURLs: [URL] = []
        var seen: Set<String> = []

        for value in captures(for: pattern, in: html) {
            guard let url = URL(string: decodeHTMLEntities(value), relativeTo: URL(string: "https://www.rebelrags.net")),
                  seen.insert(url.absoluteString).inserted else {
                continue
            }
            uniqueURLs.append(url.absoluteURL)
        }
        return uniqueURLs
    }

    private func detailMatches(_ html: String, seller: TopSeller, lookupArtCode: String) -> Bool {
        let compactHTML = normalized(html)
        let style = normalized(seller.styleNumber)
        let artCode = normalized(lookupArtCode)

        if compactHTML.contains(style + artCode) || compactHTML.contains(artCode + style) {
            return true
        }

        return compactHTML.contains(style) && compactHTML.contains(artCode)
    }

    private func imageLookup(for seller: TopSeller) -> ProductImageLookup {
        let style = normalized(seller.styleNumber)
        let artCode = normalized(seller.artCode)
        let color = normalized(seller.colorName)
        let description = normalized(seller.styleName)
        let isWhiteScriptBasicTee = style == "CT1000"
            && color == "WHITE"
            && description.contains("SCRIPTOLEMISSBASICSHORTSLEEVETEE")

        // Rebel Rags publishes the white Script Ole Miss basic tee under APC03479022; some POS exports identify it as 03456518.
        if isWhiteScriptBasicTee
            || (style == "CT1000" && color == "WHITE" && ["03456518", "0346518"].contains(artCode)) {
            return ProductImageLookup(searchArtCode: "03479022", isManualOverride: true, productURL: nil)
        }

        if style == "GDH100",
           artCode == "004116649",
           let productURL = URL(string: "https://www.rebelrags.net/gear/block-rebs-comfort-wash-ss-tee-31521") {
            return ProductImageLookup(searchArtCode: seller.artCode, isManualOverride: true, productURL: productURL)
        }

        if style == "GDH135",
           artCode == "004116649",
           let productURL = URL(string: "https://www.rebelrags.net/gear/block-rebs-comfort-wash-ss-boxy-tee-31522") {
            return ProductImageLookup(searchArtCode: seller.artCode, isManualOverride: true, productURL: productURL)
        }

        return ProductImageLookup(searchArtCode: seller.artCode, isManualOverride: false, productURL: nil)
    }

    private func productImageURL(in html: String, for seller: TopSeller, relativeTo baseURL: URL) -> URL? {
        let pattern = #"(https?://www\.rebelrags\.net/prodimages/[^"']+-l\.(?:jpg|jpeg|png)|/prodimages/[^"']+-l\.(?:jpg|jpeg|png))"#
        let imageURLs = captures(for: pattern, in: html)
        let rawURL = imageURLs.first(where: {
            imageURL($0, matchesColor: seller.colorName)
        }) ?? imageURLs.first(where: {
            canUseDefaultImageURL($0, for: seller, allImageURLs: imageURLs)
        })
        guard let rawURL else {
            return nil
        }
        return URL(string: decodeHTMLEntities(rawURL), relativeTo: baseURL)?.absoluteURL
    }

    private func fetch(_ url: URL) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: url)
        request.setValue("SalesLens/1.0 (product image matching)", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 15
        return try await URLSession.shared.data(for: request)
    }

    private func downloadImage(from imageURL: URL, to cacheURL: URL) async throws -> NSImage? {
        let (imageData, _) = try await fetch(imageURL)
        guard let image = NSImage(data: imageData) else { return nil }
        try imageData.write(to: cacheURL, options: .atomic)
        return image
    }

    private func persistAssociations() {
        guard let data = try? JSONEncoder().encode(associations) else { return }
        try? data.write(to: associationsURL, options: .atomic)
    }

    private func cacheKey(for seller: TopSeller) -> String {
        [seller.styleNumber, seller.artCode, seller.colorName]
            .map(normalized)
            .joined(separator: "_")
    }

    private func shouldInvalidateAssociation(_ association: ProductImageAssociation, for seller: TopSeller, lookup: ProductImageLookup) -> Bool {
        if association.lookupArtCode != lookup.searchArtCode {
            return true
        }
        guard let productURL = lookup.productURL else {
            return !cachedImageURL(association.imageURL, isAllowedFor: seller)
        }
        return association.productURL != productURL.absoluteString || !cachedImageURL(association.imageURL, isAllowedFor: seller)
    }

    private func cachedImageURL(_ value: String, isAllowedFor seller: TopSeller) -> Bool {
        imageURL(value, matchesColor: seller.colorName)
            || imageColorToken(for: value) == "DEFAULT"
    }

    private func imageURL(_ value: String, matchesColor colorName: String) -> Bool {
        let filename = normalized(imageFilename(for: value))
        return colorSearchTerms(for: colorName).contains { filename.contains($0) }
    }

    private func canUseDefaultImageURL(_ value: String, for seller: TopSeller, allImageURLs: [String]) -> Bool {
        guard imageColorToken(for: value) == "DEFAULT" else { return false }
        return allowsDefaultImage(for: seller) || imageURLsOnlyHaveDefaultColor(allImageURLs)
    }

    private func imageURLsOnlyHaveDefaultColor(_ imageURLs: [String]) -> Bool {
        let tokens = Set(imageURLs.map(imageColorToken).filter { !$0.isEmpty })
        return !tokens.isEmpty && tokens.isSubset(of: ["DEFAULT"])
    }

    private func imageColorToken(for value: String) -> String {
        let filename = imageFilename(for: value)
        let parts = filename.split(separator: "-").map(String.init)
        guard parts.count >= 2 else { return "" }
        return normalized(parts[parts.count - 2])
    }

    private func imageFilename(for value: String) -> String {
        let decoded = decodeHTMLEntities(value)
        let path = URL(string: decoded)?.lastPathComponent ?? URL(fileURLWithPath: decoded).lastPathComponent
        return (path as NSString).deletingPathExtension
    }

    private func colorSearchTerms(for colorName: String) -> [String] {
        let normalizedColor = normalized(colorName)
        var terms = [normalizedColor]
        if normalizedColor == "LIGHTBLUE" {
            terms.append("LTBLUE")
        }
        if normalizedColor == "HEATHERGREY" {
            terms.append("HEATHERGRAY")
        }
        if normalizedColor == "SILVERGREY" {
            terms.append("SILVERGRAY")
        }
        return terms
    }

    private func allowsDefaultImage(for seller: TopSeller) -> Bool {
        let color = normalized(seller.colorName)
        if color == "WHITE" {
            return true
        }
        return false
    }

    private func captures(for pattern: String, in text: String) -> [String] {
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return []
        }
        let range = NSRange(text.startIndex..., in: text)
        return expression.matches(in: text, range: range).compactMap { match in
            guard match.numberOfRanges > 1,
                  let captureRange = Range(match.range(at: 1), in: text) else {
                return nil
            }
            return String(text[captureRange])
        }
    }

    private func normalized(_ value: String) -> String {
        String(value.uppercased().filter { $0.isLetter || $0.isNumber })
    }

    private func decodeHTMLEntities(_ value: String) -> String {
        value.replacingOccurrences(of: "&amp;", with: "&")
    }

    private func isRebelRags(_ customerName: String?) -> Bool {
        customerName?.caseInsensitiveCompare("Rebel Rags") == .orderedSame
    }
}

private struct ProductImageMatch {
    let productURL: URL
    let imageURL: URL
}

private struct ProductImageLookup {
    let searchArtCode: String
    let isManualOverride: Bool
    let productURL: URL?
}

private struct ProductImageAssociation: Codable {
    let styleNumber: String
    let artCode: String
    let colorName: String
    let productURL: String
    let imageURL: String
    let localFileName: String
    let matchedAt: Date
    let lookupArtCode: String?
}
