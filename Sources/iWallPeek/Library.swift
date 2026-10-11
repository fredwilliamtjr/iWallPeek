import AppKit
import Foundation

struct SavedImage: Codable, Identifiable {
    let image: DailyImage
    let filename: String
    var id: String { image.id }
}

enum Exporter {
    static func write(_ data: Data, image: DailyImage, folder: URL) throws -> URL {
        try Safety.validateImage(data)
        guard folder.isFileURL, try folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
            throw WallError.invalid("Selecione uma pasta válida para salvar as imagens.")
        }
        let ext = data.starts(with: [0x89, 0x50, 0x4e, 0x47]) ? "png" : "jpg"
        let day = image.date.filter { $0.isASCII && $0.isNumber }
        let name = "iWallPeek-" + image.source.rawValue + "-" + String(day.prefix(8)) + "-" + image.id.prefix(16) + "." + ext
        let destination = folder.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: destination.path) {
            let attributes = try destination.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard attributes.isRegularFile == true, attributes.isSymbolicLink != true,
                  attributes.fileSize == data.count, try Data(contentsOf: destination) == data else {
                throw WallError.invalid("Já existe um arquivo diferente com esse nome. Nenhum arquivo foi substituído.")
            }
        } else { try data.write(to: destination, options: .withoutOverwriting) }
        return destination
    }
}

@MainActor
final class WallModel: ObservableObject {
    @Published var source: Source { didSet { defaults.set(source.rawValue, forKey: "source") } }
    @Published var region: String { didSet { defaults.set(region, forKey: "bingRegion") } }
    @Published var allSpaces: Bool { didSet { defaults.set(allSpaces, forKey: "allSpaces") } }
    @Published var retention: Int { didSet { defaults.set(retention, forKey: "retention") } }
    @Published var autoBing: Bool { didSet { defaults.set(autoBing, forKey: "auto.bing") } }
    @Published var autoSpotlight: Bool { didSet { defaults.set(autoSpotlight, forKey: "auto.spotlight") } }
    @Published var folderBing: String
    @Published var folderSpotlight: String
    @Published var catalog: [DailyImage] = []
    @Published var selectedID: String?
    @Published var preview: NSImage?
    @Published var busy = false
    @Published var status = "Pronto"
    @Published var currentTitle: String
    @Published var currentSource: Source?
    @Published var currentPreview: NSImage?
    @Published var loginEnabled = false
    @Published var spaceStatus = "Aguardando aplicação"
    private let defaults: UserDefaults
    private let service = WallpaperService()
    let store: ImageStore
    private var records: [SavedImage] = []
    private var currentURL: URL?
    var selected: DailyImage? { catalog.first { $0.id == selectedID } }
    var folderLabel: String { source == .bing ? folderBing : folderSpotlight }
    init(defaults: UserDefaults = .standard, store: ImageStore = ImageStore()) {
        self.defaults = defaults
        self.store = store
        source = Source(rawValue: defaults.string(forKey: "source") ?? "bing") ?? .bing
        region = defaults.string(forKey: "bingRegion") ?? "auto"
        allSpaces = defaults.object(forKey: "allSpaces") == nil || defaults.bool(forKey: "allSpaces")
        let days = defaults.integer(forKey: "retention")
        retention = [7,30,90].contains(days) ? days : 30
        autoBing = defaults.bool(forKey: "auto.bing")
        autoSpotlight = defaults.bool(forKey: "auto.spotlight")
        folderBing = defaults.string(forKey: "folderLabel.bing") ?? "Nenhuma pasta selecionada"
        folderSpotlight = defaults.string(forKey: "folderLabel.spotlight") ?? "Nenhuma pasta selecionada"
        currentTitle = defaults.string(forKey: "imageTitle") ?? "Nenhuma imagem aplicada"
        spaceStatus = defaults.string(forKey: "spaceStatus.v2") ?? "Aguardando aplicação"
        if let data = defaults.data(forKey: "library.v2"), let saved = try? JSONDecoder().decode([SavedImage].self, from: data) {
            records = saved.filter { validFile($0.filename) != nil }
        }
        if let path = defaults.string(forKey: "currentPath"), let url = validFile(URL(fileURLWithPath: path).lastPathComponent), url.path == path {
            currentURL = url
            currentPreview = NSImage(contentsOf: url)
            currentSource = records.first { $0.filename == url.lastPathComponent }?.image.source
        }
    }
    private func validFile(_ name: String) -> URL? {
        guard name == URL(fileURLWithPath: name).lastPathComponent,
              ["jpg", "png"].contains(URL(fileURLWithPath: name).pathExtension),
              UUID(uuidString: URL(fileURLWithPath: name).deletingPathExtension().lastPathComponent) != nil else { return nil }
        let url = store.root.appendingPathComponent(name)
        guard url.standardizedFileURL == url.resolvingSymlinksInPath().standardizedFileURL,
              let attributes = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
              attributes.isRegularFile == true, (attributes.fileSize ?? Int.max) <= Safety.maxImageBytes else { return nil }
        return url
    }
    private func cached(_ image: DailyImage) async throws -> (URL, Data) {
        if let entry = records.first(where: { $0.id == image.id }), let url = validFile(entry.filename) {
            let data = try Data(contentsOf: url); try Safety.validateImage(data); return (url, data)
        }
        let data = try await service.download(image)
        let url = try store.save(data)
        records.removeAll { $0.id == image.id }
        records.insert(SavedImage(image: image, filename: url.lastPathComponent), at: 0)
        try store.prune(keeping: currentURL ?? url, days: retention, additionally: [url])
        persistLibrary()
        return (url, data)
    }
    private func persistLibrary() {
        records = Array(records.filter { validFile($0.filename) != nil }.prefix(1000))
        if let data = try? JSONEncoder().encode(records) { defaults.set(data, forKey: "library.v2") }
    }
    func loadCatalog(_ serviceSource: Source) {
        guard !busy else { return }
        busy = true; status = "Buscando histórico de \(serviceSource.title)…"; preview = nil
        Task {
            defer { busy = false }
            do {
                let fetched = try await service.catalog(serviceSource, region: region, history: true)
                let local = records.filter { $0.image.source == serviceSource && (serviceSource != .bing || $0.image.market == WallpaperService.market(region)) }.map(\.image)
                var seen = Set<String>()
                catalog = (fetched + local).filter { seen.insert($0.id).inserted }.sorted { $0.date > $1.date }
                selectedID = catalog.first?.id
                if let image = selected { let (_, data) = try await cached(image); preview = NSImage(data: data) }
                status = serviceSource == .bing ? "Histórico do Bing: imagens recentes da região escolhida e imagens já baixadas." : "Spotlight: imagem atual e histórico local das imagens obtidas pelo iWallPeek."
            } catch {
                catalog = records.filter { $0.image.source == serviceSource && (serviceSource != .bing || $0.image.market == WallpaperService.market(region)) }.map(\.image)
                selectedID = catalog.first?.id
                if let image = selected, let (_, data) = try? await cached(image) { preview = NSImage(data: data) }
                status = "Não foi possível atualizar o histórico: " + error.localizedDescription
            }
        }
    }
    func select(_ id: String?) {
        guard !busy, let id, let image = catalog.first(where: { $0.id == id }) else { return }
        selectedID = id; busy = true; preview = nil
        Task {
            defer { busy = false }
            do { let (_, data) = try await cached(image); preview = NSImage(data: data); status = image.title }
            catch { status = "Erro ao visualizar: " + error.localizedDescription }
        }
    }
    func move(_ offset: Int) {
        guard let id = selectedID, let index = catalog.firstIndex(where: { $0.id == id }), catalog.indices.contains(index + offset) else { return }
        select(catalog[index + offset].id)
    }
    func chooseFolder(_ source: Source) {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.canCreateDirectories = true; panel.allowsMultipleSelection = false
        panel.prompt = "Escolher pasta"; panel.message = "Pasta de autossalvamento — " + source.title
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        do {
            let bookmark = try folder.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
            defaults.set(bookmark, forKey: "folder." + source.rawValue)
            defaults.set(folder.path, forKey: "folderLabel." + source.rawValue)
            if source == .bing { folderBing = folder.path } else { folderSpotlight = folder.path }
        } catch { status = "Não foi possível guardar a pasta: " + error.localizedDescription }
    }
    private func folder(_ source: Source) throws -> URL {
        guard let bookmark = defaults.data(forKey: "folder." + source.rawValue) else { throw WallError.invalid("Escolha a pasta de autossalvamento de \(source.title).") }
        var stale = false
        let url = try URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale)
        if stale { throw WallError.invalid("A pasta de \(source.title) mudou. Escolha-a novamente.") }
        return url
    }
    private func autoExport(_ data: Data, image: DailyImage) throws {
        guard image.source == .bing ? autoBing : autoSpotlight else { return }
        let url = try folder(image.source)
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        _ = try Exporter.write(data, image: image, folder: url)
    }
    func saveSelected() {
        guard !busy, let image = selected else { return }
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.canCreateDirectories = true; panel.allowsMultipleSelection = false; panel.prompt = "Salvar nesta pasta"
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        busy = true
        Task {
            defer { busy = false }
            do { let (_, data) = try await cached(image); let url = try Exporter.write(data, image: image, folder: folder); status = "Imagem salva em " + url.path }
            catch { status = "Erro ao salvar: " + error.localizedDescription }
        }
    }
    func applySelected() {
        guard !busy, let image = selected else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let (url, data) = try await cached(image)
                try await apply(image, url: url, data: data)
                // Keep this history image until tomorrow; browsing alone never changes the wallpaper.
                defaults.set(dailyKey(image.source), forKey: "applied.v2")
                status = "Imagem aplicada como plano de fundo." + (spaceStatus.contains("reaplicada") ? " " + spaceStatus : "")
            } catch { status = "Erro ao aplicar: " + error.localizedDescription }
        }
    }
    private func apply(_ image: DailyImage, url: URL, data: Data) async throws {
        let warning = try await applyWallpaper(url, allSpaces: allSpaces)
        currentURL = url; currentTitle = image.title; currentPreview = NSImage(data: data); currentSource = image.source
        source = image.source
        defaults.set(url.path, forKey: "currentPath"); defaults.set(image.title, forKey: "imageTitle")
        spaceStatus = warning ?? (allSpaces ? "Configuração global gravada para todas as mesas." : "Aplicado nas mesas ativas.")
        defaults.set(warning != nil, forKey: "needsSpaceFallback")
        defaults.set(spaceStatus, forKey: "spaceStatus.v2")
        try store.prune(keeping: url, days: retention); persistLibrary()
    }
    private func dailyKey(_ source: Source) -> String {
        WallpaperService.day() + ":" + source.rawValue + ":" + (source == .bing ? WallpaperService.market(region) : "auto")
    }
    func refreshDaily(force: Bool = false, exportOnly: Source? = nil) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            var failures: [String] = []
            let wallpaperSource = source
            for serviceSource in Source.allCases {
                if let exportOnly, serviceSource != exportOnly { continue }
                let autosave = serviceSource == .bing ? autoBing : autoSpotlight
                let mustApply = exportOnly == nil && serviceSource == wallpaperSource && (force || currentURL == nil || defaults.string(forKey: "applied.v2") != dailyKey(serviceSource))
                let exportKey = dailyKey(serviceSource) + ":" + (serviceSource == .bing ? folderBing : folderSpotlight)
                let mustExport = autosave && (force || defaults.string(forKey: "exported." + serviceSource.rawValue) != exportKey)
                guard mustApply || mustExport else { continue }
                do {
                    status = "Buscando imagem de \(serviceSource.title)…"
                    let image = try await service.fetch(serviceSource, region: region)
                    let (url, data) = try await cached(image)
                    // An export failure must not hide the other service or stop applying the desktop.
                    if mustApply {
                        do { try await apply(image, url: url, data: data); defaults.set(dailyKey(serviceSource), forKey: "applied.v2") }
                        catch { failures.append("Plano de fundo: " + error.localizedDescription) }
                    }
                    if mustExport {
                        do { try autoExport(data, image: image); defaults.set(exportKey, forKey: "exported." + serviceSource.rawValue) }
                        catch { failures.append("Autossalvar \(serviceSource.title): " + error.localizedDescription) }
                    }
                } catch { failures.append(serviceSource.title + ": " + error.localizedDescription) }
            }
            status = failures.isEmpty ? "Atualização concluída." : failures.joined(separator: "\n")
        }
    }
    func reapplyToActiveSpace() {
        guard allSpaces, !busy, let url = currentURL, let data = try? Data(contentsOf: url), (try? Safety.validateImage(data)) != nil else { return }
        // Don't rewrite global config or restart the agent on every Space switch.
        // If global mode is working it already covers the Space. Fallback applies only when needed.
        guard defaults.bool(forKey: "needsSpaceFallback") || ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 14 else { return }
        for screen in NSScreen.screens {
            do { try NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:]) }
            catch { spaceStatus = "Falha ao reaplicar nesta mesa: " + error.localizedDescription }
        }
    }
    func applyCurrentToSpaces() {
        guard !busy, let url = currentURL else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let warning = try await applyWallpaper(url, allSpaces: allSpaces)
                spaceStatus = warning ?? (allSpaces ? "Configuração global gravada para todas as mesas." : "Aplicado nas mesas ativas.")
                defaults.set(warning != nil, forKey: "needsSpaceFallback")
                defaults.set(spaceStatus, forKey: "spaceStatus.v2")
            }
            catch { spaceStatus = error.localizedDescription }
        }
    }
    func openFolder(_ source: Source) {
        do { NSWorkspace.shared.open(try folder(source)) } catch { status = error.localizedDescription }
    }
}
