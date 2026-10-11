import AppKit
import Foundation
import ImageIO

enum Source: String, CaseIterable {
    case bing, spotlight
    var title: String { self == .bing ? "Bing" : "Windows Spotlight" }
}
struct DailyImage { let url: URL; let title: String }

final class WallpaperService {
    private let http = SafeHTTP()
    func fetch(_ source: Source) async throws -> DailyImage {
        let language = Locale.current.language.languageCode?.identifier ?? "pt"
        let country = Locale.current.region?.identifier ?? "BR"
        let locale = language + "-" + country
        var components = URLComponents(string: source == .bing
            ? "https://www.bing.com/HPImageArchive.aspx" : "https://arc.msn.com/v3/Delivery/Placement")!
        if source == .bing {
            components.queryItems = [URLQueryItem(name: "format", value: "js"), URLQueryItem(name: "idx", value: "0"),
                URLQueryItem(name: "n", value: "1"), URLQueryItem(name: "mkt", value: locale)]
        } else {
            let values = ["pid":"338387", "fmt":"json", "rafb":"0", "ua":"WindowsShellClient/0", "cdm":"1",
                "disphorzres":"9999", "dispvertres":"9999", "lo":"80217", "pl":locale, "lc":locale,
                "ctry":country, "time":ISO8601DateFormatter().string(from: Date())]
            components.queryItems = values.sorted { $0.key < $1.key }.map { URLQueryItem(name:$0.key, value:$0.value) }
        }
        guard let endpoint = components.url else { throw WallError.invalid("Endereço inválido.") }
        let data = try await http.get(endpoint, limit: 2 * 1024 * 1024)
        if source == .bing {
            struct Feed: Decodable { struct Item: Decodable { let urlbase: String; let title: String? }; let images: [Item] }
            guard let image = try JSONDecoder().decode(Feed.self, from: data).images.first,
                  image.urlbase.hasPrefix("/th?"),
                  let url = URL(string: "https://www.bing.com" + image.urlbase + "_UHD.jpg")
            else { throw WallError.invalid("Bing não retornou uma imagem válida.") }
            try Safety.validateURL(url)
            return DailyImage(url: url, title: image.title ?? "Imagem do dia do Bing")
        }
        struct Feed: Decodable { struct Batch: Decodable { struct Item: Decodable { let item: String }; let items: [Item] }; let batchrsp: Batch }
        struct Ad: Decodable { struct Asset: Decodable { let t: String; let u: String?; let tx: String? }; let ad: [String: Asset] }
        guard let first = try JSONDecoder().decode(Feed.self, from: data).batchrsp.items.first,
              let nested = first.item.data(using: .utf8) else { throw WallError.invalid("Spotlight sem conteúdo.") }
        let ad = try JSONDecoder().decode(Ad.self, from: nested)
        guard let asset = ad.ad["image_fullscreen_001_landscape"], asset.t == "img",
              let address = asset.u, let url = URL(string: address) else { throw WallError.invalid("Spotlight sem imagem horizontal.") }
        try Safety.validateURL(url)
        return DailyImage(url: url, title: ad.ad["hs1_title_text"]?.tx ?? "Imagem do Windows Spotlight")
    }
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
    func prune(keeping current: URL, days: Int) throws {
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
        for (file, date, size) in entries.sorted(by: { $0.1 < $1.1 }) where file != current {
            if date < cutoff || total > 500 * 1024 * 1024 {
                try fm.removeItem(at: file); total -= size
            }
        }
    }
}

@MainActor
func applyWallpaper(_ url: URL, allSpaces: Bool) async throws -> String? {
    guard !NSScreen.screens.isEmpty else { throw WallError.invalid("Nenhum monitor disponível.") }
    var failures = 0
    for screen in NSScreen.screens {
        do { try NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:]) }
        catch { failures += 1 }
    }
    guard failures < NSScreen.screens.count else { throw WallError.invalid("Não foi possível aplicar a imagem nos monitores.") }
    let partialWarning: String? = failures > 0 ? "A imagem não pôde ser aplicada em alguns monitores." : nil
    guard allSpaces else { return partialWarning }
    // Static program; untrusted/user paths travel as argv, never as source or shell commands.
    let script = """
    on run argv
        tell application "System Events"
            repeat with aDesktop in every desktop
                set picture of aDesktop to item 1 of argv
            end repeat
        end tell
    end run
    """
    let status = try await Task.detached {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script, url.path]
        let errors = Pipe()
        process.standardError = errors
        process.standardOutput = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus
    }.value
    if status != 0 {
        return "Imagem aplicada nos monitores; não foi possível aplicar em todos os Spaces. Verifique a permissão de Automação."
    }
    return partialWarning
}
