import AppKit
import ServiceManagement

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var status: NSStatusItem!
    private let service = WallpaperService()
    private let store = ImageStore()
    private let defaults = UserDefaults.standard
    private var timer: Timer?
    private var busy = false
    private var message = "Aguardando atualização"
    private var currentURL: URL?
    private var source: Source { Source(rawValue: defaults.string(forKey: "source") ?? "bing") ?? .bing }
    private var retention: Int { let value = defaults.integer(forKey: "retention"); return [7,30,90].contains(value) ? value : 30 }
    private var allSpaces: Bool { defaults.object(forKey: "allSpaces") == nil || defaults.bool(forKey: "allSpaces") }
    private var today: String { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date()) }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.image = NSImage(systemSymbolName: "photo.on.rectangle.angled", accessibilityDescription: "iWallPeek")
        status.button?.toolTip = "iWallPeek — imagem do dia"
        rebuildMenu()
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(checkDaily), name: NSWorkspace.didWakeNotification, object: nil)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(checkDaily), name: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil)
        timer = Timer.scheduledTimer(withTimeInterval: 900, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh(force: false) }
        }
        if let path = defaults.string(forKey: "currentPath") {
            let url = URL(fileURLWithPath: path)
            if url.deletingLastPathComponent() == store.root && FileManager.default.fileExists(atPath: path) { currentURL = url }
        }
        refresh(force: false)
    }
    private func item(_ title: String, _ action: Selector?, tag: Int = 0, checked: Bool = false) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: ""); i.target = self; i.tag = tag
        i.state = checked ? .on : .off; return i
    }
    private func rebuildMenu() {
        let menu = NSMenu()
        menu.addItem(item("iWallPeek 0.1.0", nil))
        menu.addItem(item(String(message.prefix(110)), nil))
        menu.addItem(.separator())
        for (index, sourceOption) in Source.allCases.enumerated() {
            let sourceItem = item(sourceOption.title, #selector(selectSource(_:)), tag: index, checked: source == sourceOption)
            sourceItem.isEnabled = !busy
            menu.addItem(sourceItem)
        }
        let refreshItem = item(busy ? "Atualizando…" : "Atualizar agora", #selector(forceRefresh)); refreshItem.isEnabled = !busy
        menu.addItem(refreshItem)
        menu.addItem(item("Abrir pasta das imagens", #selector(openFolder)))
        menu.addItem(.separator())
        menu.addItem(item("Aplicar em todos os Spaces", #selector(toggleSpaces), checked: allSpaces))
        menu.addItem(item("Iniciar com o macOS", #selector(toggleLogin), checked: SMAppService.mainApp.status == .enabled))
        let retentionItem = item("Guardar imagens por", nil)
        let submenu = NSMenu()
        for days in [7,30,90] { submenu.addItem(item("\(days) dias (máximo 500 MB)", #selector(setRetention(_:)), tag: days, checked: retention == days)) }
        retentionItem.submenu = submenu; menu.addItem(retentionItem)
        menu.addItem(.separator())
        menu.addItem(item("Sobre o iWallPeek", #selector(about)))
        menu.addItem(item("Sair", #selector(quit)))
        menu.autoenablesItems = false
        for i in menu.items where i.action == nil && i.submenu == nil { i.isEnabled = false }
        status.menu = menu
    }
    @objc private func checkDaily() { refresh(force: false) }
    @objc private func forceRefresh() { refresh(force: true) }
    @objc private func selectSource(_ sender: NSMenuItem) {
        defaults.set(Source.allCases[sender.tag].rawValue, forKey: "source"); refresh(force: true)
    }
    private func refresh(force: Bool) {
        guard !busy else { return }
        let selected = source
        let key = today + ":" + selected.rawValue
        if !force, defaults.string(forKey: "lastApplied") == key, currentURL != nil {
            message = defaults.string(forKey: "imageTitle") ?? "Imagem do dia atualizada"; rebuildMenu(); return
        }
        busy = true; message = "Buscando imagem…"; rebuildMenu()
        Task { @MainActor in
            defer { busy = false; rebuildMenu() }
            do {
                let image = try await service.fetch(selected)
                let data = try await service.download(image)
                let url = try store.save(data)
                let warning = try await applyWallpaper(url, allSpaces: allSpaces)
                currentURL = url
                defaults.set(url.path, forKey: "currentPath")
                defaults.set(key, forKey: "lastApplied")
                defaults.set(image.title, forKey: "imageTitle")
                message = warning ?? image.title
                try store.prune(keeping: url, days: retention)
            } catch { message = "Erro: " + error.localizedDescription }
        }
    }
    @objc private func openFolder() { NSWorkspace.shared.open(store.root) }
    @objc private func toggleSpaces() { defaults.set(!allSpaces, forKey: "allSpaces"); rebuildMenu(); refresh(force: true) }
    @objc private func setRetention(_ sender: NSMenuItem) {
        defaults.set(sender.tag, forKey: "retention")
        do { if let url = currentURL { try store.prune(keeping: url, days: retention) } }
        catch { message = error.localizedDescription }
        rebuildMenu()
    }
    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register()
                if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
            }
        } catch { showAlert("Início com o macOS", error.localizedDescription) }
        rebuildMenu()
    }
    private func showAlert(_ title: String, _ text: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert(); a.messageText = title; a.informativeText = text; a.runModal()
    }
    @objc private func about() {
        showAlert("iWallPeek 0.1.0", "Imagens diárias do Bing e Windows Spotlight.\nBaseado no DailyWalls, de Xiaohan Tian (MIT).\nAs fotografias pertencem aos respectivos titulares.\n\nA tela de bloqueio segue o comportamento do macOS; não há configuração separada.\n\nDados: idioma/região enviados aos serviços Microsoft; sem conta ou telemetria própria.")
    }
    @objc private func quit() { NSApp.terminate(nil) }
}
@main
struct iWallPeekApp {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
