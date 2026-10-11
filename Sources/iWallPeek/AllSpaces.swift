import AppKit
import Foundation

// WallpaperAgent schema approach derived from treschar/wallall (MIT); see THIRD_PARTY_LICENSES.
// Pure transformation, tested with fixtures; unrelated Spaces/Displays/Idle entries are preserved.
enum WallpaperIndex {
    static func updated(_ original: Data, image: URL) throws -> Data {
        guard image.isFileURL,
              var root = try PropertyListSerialization.propertyList(from: original, options: [], format: nil) as? [String: Any],
              root["Spaces"] is [String: Any], root["Displays"] is [String: Any],
              root["AllSpacesAndDisplays"] is [String: Any] || (root["AllSpacesAndDisplays"] as? String == "$null")
        else { throw WallError.invalid("Estrutura de wallpaper do macOS não reconhecida.") }
        let config = try PropertyListSerialization.data(fromPropertyList: ["type": "imageFile", "url": ["relative": image.absoluteString]], format: .binary, options: 0)
        let desktop: [String: Any] = ["Content": ["Choices": [["Configuration": config, "Files": [Any](), "Provider": "com.apple.wallpaper.choice.image"]],
            "EncodedOptionValues": "$null", "Shuffle": "$null"], "LastSet": Date(), "LastUse": Date()]
        var global = root["AllSpacesAndDisplays"] as? [String: Any] ?? [:]
        global["Desktop"] = desktop
        global["Type"] = "desktop"
        root["AllSpacesAndDisplays"] = global
        return try PropertyListSerialization.data(fromPropertyList: root, format: .binary, options: 0)
    }
    static func write(image: URL) throws {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        let path = home.appendingPathComponent("Library/Application Support/com.apple.wallpaper/Store/Index.plist")
        guard path.standardizedFileURL == path.resolvingSymlinksInPath().standardizedFileURL,
              try path.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]).isRegularFile == true,
              (try path.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max) < 10 * 1024 * 1024
        else { throw WallError.invalid("Armazenamento de wallpaper indisponível ou inseguro.") }
        let attributes = try fm.attributesOfItem(atPath: path.path)
        let original = try Data(contentsOf: path)
        let updated = try Self.updated(original, image: image)
        let backups = home.appendingPathComponent("Library/Application Support/iWallPeek/WallpaperBackups")
        guard backups.standardizedFileURL == backups.resolvingSymlinksInPath().standardizedFileURL else {
            throw WallError.invalid("Pasta de backup não pode ser link simbólico.")
        }
        try fm.createDirectory(at: backups, withIntermediateDirectories: true)
        let backup = backups.appendingPathComponent(UUID().uuidString + ".plist")
        try original.write(to: backup, options: .withoutOverwriting)
        // Refuse to overwrite a concurrent change made by System Settings/another app.
        guard try Data(contentsOf: path) == original else { throw WallError.invalid("O wallpaper mudou durante a operação. Tente novamente.") }
        try updated.write(to: path, options: .atomic)
        if let permissions = attributes[.posixPermissions] { try fm.setAttributes([.posixPermissions: permissions], ofItemAtPath: path.path) }
        guard try Data(contentsOf: path) == updated else { throw WallError.invalid("Não foi possível confirmar a gravação para todas as mesas.") }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
        process.arguments = ["-u", NSUserName(), "WallpaperAgent"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run(); process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw WallError.invalid("Configuração salva; WallpaperAgent não confirmou o recarregamento.") }
    }
}

@MainActor
func applyWallpaper(_ url: URL, allSpaces: Bool) async throws -> String? {
    var warning: String?
    if allSpaces, #available(macOS 14, *) {
        do { try await Task.detached { try WallpaperIndex.write(image: url) }.value; return nil }
        catch { warning = "Todas as mesas: " + error.localizedDescription + " A imagem será reaplicada ao trocar de mesa." }
    } else if allSpaces { warning = "Neste macOS, a imagem será reaplicada ao trocar de mesa." }
    guard !NSScreen.screens.isEmpty else { throw WallError.invalid("Nenhum monitor disponível.") }
    var failures = 0
    for screen in NSScreen.screens {
        do { try NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:]) }
        catch { failures += 1 }
    }
    guard failures < NSScreen.screens.count else { throw WallError.invalid("Não foi possível aplicar a imagem nos monitores.") }
    return warning ?? (failures > 0 ? "A imagem não foi aplicada em alguns monitores." : nil)
}
