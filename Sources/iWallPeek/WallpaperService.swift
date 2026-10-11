import AppKit
import Foundation
import ImageIO
import CryptoKit

enum Source: String, CaseIterable, Codable {
    case bing, spotlight
    var title: String { self == .bing ? "Bing" : "Windows Spotlight" }
}
struct DailyImage: Codable, Identifiable, Equatable {
    let url: URL
    let title: String
    let date: String
    let source: Source
    let market: String
    var id: String { SHA256.hash(data: Data((source.rawValue + market + url.absoluteString).utf8)).map { String(format: "%02x", $0) }.joined() }
}

final class WallpaperService {
    private let http = SafeHTTP()
    static let markets: [(String, String)] = [
        ("auto", "Região atual do Mac"), ("pt-BR", "Brasil"), ("en-US", "Estados Unidos"),
        ("en-GB", "Reino Unido"), ("en-CA", "Canadá (inglês)"), ("fr-CA", "Canadá (francês)"),
        ("de-DE", "Alemanha"), ("fr-FR", "França"), ("it-IT", "Itália"), ("es-ES", "Espanha"),
        ("ja-JP", "Japão"), ("zh-CN", "China"), ("en-IN", "Índia"), ("en-AU", "Austrália")
    ]
    static func market(_ selection: String) -> String {
        guard selection != "auto", markets.contains(where: { $0.0 == selection }) else {
            return (Locale.current.language.languageCode?.identifier ?? "pt") + "-" + (Locale.current.region?.identifier ?? "BR")
        }
        return selection
    }
    func fetch(_ source: Source, region: String = "auto") async throws -> DailyImage {
        guard let image = try await catalog(source, region: region, history: false).first else { throw WallError.invalid("Nenhuma imagem disponível.") }
        return image
    }
    func catalog(_ source: Source, region: String, history: Bool) async throws -> [DailyImage] {
        let locale = Self.market(source == .bing ? region : "auto")
        var components = URLComponents(string: source == .bing
            ? "https://www.bing.com/HPImageArchive.aspx" : "https://arc.msn.com/v3/Delivery/Placement")!
        if source == .bing {
            components.queryItems = [URLQueryItem(name: "format", value: "js"), URLQueryItem(name: "idx", value: "0"),
                URLQueryItem(name: "n", value: history ? "8" : "1"), URLQueryItem(name: "mkt", value: locale)]
        } else {
            let country = Locale.current.region?.identifier ?? "BR"
            let values = ["pid":"338387", "fmt":"json", "rafb":"0", "ua":"WindowsShellClient/0", "cdm":"1",
                "disphorzres":"9999", "dispvertres":"9999", "lo":"80217", "pl":locale, "lc":locale,
                "ctry":country, "time":ISO8601DateFormatter().string(from: Date())]
            components.queryItems = values.sorted { $0.key < $1.key }.map { URLQueryItem(name:$0.key, value:$0.value) }
        }
        guard let endpoint = components.url else { throw WallError.invalid("Endereço inválido.") }
        let data = try await http.get(endpoint, limit: 2 * 1024 * 1024)
        if source == .bing {
            struct Feed: Decodable {
                struct Item: Decodable { let urlbase: String; let title: String?; let copyright: String?; let startdate: String }
                let images: [Item]
            }
            let feed = try JSONDecoder().decode(Feed.self, from: data)
            // Invalid items do not hide the remaining valid history.
            let images = feed.images.compactMap { image -> DailyImage? in
                guard image.urlbase.hasPrefix("/th?"), let url = URL(string: "https://www.bing.com" + image.urlbase + "_UHD.jpg"),
                      (try? Safety.validateURL(url)) != nil else { return nil }
                let title = [image.title, image.copyright].compactMap { $0 }.joined(separator: " — ")
                return DailyImage(url: url, title: title.isEmpty ? "Imagem do Bing" : title, date: image.startdate, source: .bing, market: locale)
            }
            guard !images.isEmpty else { throw WallError.invalid("Bing não retornou imagens válidas.") }
            return images
        }
        struct Feed: Decodable { struct Batch: Decodable { struct Item: Decodable { let item: String }; let items: [Item] }; let batchrsp: Batch }
        struct Ad: Decodable { struct Asset: Decodable { let t: String; let u: String?; let tx: String? }; let ad: [String: Asset] }
        let feed = try JSONDecoder().decode(Feed.self, from: data)
        var images: [DailyImage] = []
        for item in feed.batchrsp.items {
            guard let nested = item.item.data(using: .utf8), let ad = try? JSONDecoder().decode(Ad.self, from: nested),
                  let asset = ad.ad["image_fullscreen_001_landscape"], asset.t == "img", let address = asset.u,
                  let url = URL(string: address), (try? Safety.validateURL(url)) != nil else { continue }
            images.append(DailyImage(url: url, title: ad.ad["hs1_title_text"]?.tx ?? "Imagem do Windows Spotlight",
                date: Self.day(), source: .spotlight, market: locale))
        }
        guard !images.isEmpty else { throw WallError.invalid("Spotlight não retornou imagens válidas.") }
        return images
    }
    static func day() -> String { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyyMMdd"; return f.string(from: Date()) }
    func download(_ image: DailyImage) async throws -> Data {
        let data = try await http.get(image.url, limit: Safety.maxImageBytes)
        try Safety.validateImage(data)
        return data
    }
}

final class ImageStore {
    let root: URL
    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("iWallPeek/Wallpapers", isDirectory: true)
    }
    private func checkDirectory() throws {
        let fm = FileManager.default
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        guard root.standardizedFileURL.path == root.resolvingSymlinksInPath().standardizedFileURL.path else {
            throw WallError.invalid("A pasta de imagens não pode ser um link simbólico.")
        }
    }
    func save(_ data: Data) throws -> URL {
        try Safety.validateImage(data)
        try checkDirectory()
        // Neither filename nor extension comes from external metadata.
        let source = CGImageSourceCreateWithData(data as CFData, nil)!
        let ext = (CGImageSourceGetType(source) as String?) == "public.png" ? "png" : "jpg"
        let url = root.appendingPathComponent(UUID().uuidString + "." + ext)
        try data.write(to: url, options: .withoutOverwriting)
        return url
    }
    func prune(keeping current: URL, days: Int, additionally: [URL] = []) throws {
        try checkDirectory()
        let fm = FileManager.default
        let files = try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .contentModificationDateKey, .fileSizeKey])
        let cutoff = Date().addingTimeInterval(-Double(days) * 86400)
        var entries: [(URL, Date, Int)] = []
        for file in files where ["jpg", "png"].contains(file.pathExtension) && UUID(uuidString: file.deletingPathExtension().lastPathComponent) != nil {
            let v = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .contentModificationDateKey, .fileSizeKey])
            guard v.isRegularFile == true, v.isSymbolicLink != true else { continue }
            entries.append((file, v.contentModificationDate ?? .distantPast, v.fileSize ?? 0))
        }
        var total = entries.reduce(0) { $0 + $1.2 }
        for (file, date, size) in entries.sorted(by: { $0.1 < $1.1 }) where file != current && !additionally.contains(file) {
            if date < cutoff || total > 500 * 1024 * 1024 {
                try fm.removeItem(at: file); total -= size
            }
        }
    }
}
