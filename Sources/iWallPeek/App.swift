import AppKit
import SwiftUI
import ServiceManagement

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let model = WallModel()
    private var window: NSWindow?
    private var timer: Timer?
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        model.loginEnabled = SMAppService.mainApp.status == .enabled
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "photo.on.rectangle.angled", accessibilityDescription: "iWallPeek")
        statusItem.button?.toolTip = "iWallPeek — imagens diárias"
        let menu = NSMenu()
        let open = NSMenuItem(title: "Abrir iWallPeek…", action: #selector(showWindow), keyEquivalent: "")
        open.target = self; menu.addItem(open)
        let update = NSMenuItem(title: "Atualizar imagem diária", action: #selector(forceRefresh), keyEquivalent: "")
        update.target = self; menu.addItem(update); menu.addItem(.separator())
        let quit = NSMenuItem(title: "Sair", action: #selector(quit), keyEquivalent: "q")
        quit.target = self; menu.addItem(quit); statusItem.menu = menu
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(self, selector: #selector(checkDaily), name: NSWorkspace.didWakeNotification, object: nil)
        center.addObserver(self, selector: #selector(spaceChanged), name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(spaceChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(checkDaily), name: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil)
        timer = Timer.scheduledTimer(withTimeInterval: 900, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.model.refreshDaily() }
        }
        if !UserDefaults.standard.bool(forKey: "didShow.v2") {
            showWindow(); UserDefaults.standard.set(true, forKey: "didShow.v2")
        }
        model.refreshDaily()
    }
    @objc private func showWindow() {
        if window == nil {
            let view = NSHostingController(rootView: SettingsView(model: model))
            let created = NSWindow(contentViewController: view)
            created.title = "iWallPeek"; created.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            created.setContentSize(NSSize(width: 1040, height: 760)); created.center()
            created.isReleasedWhenClosed = false; window = created
        }
        model.loginEnabled = SMAppService.mainApp.status == .enabled
        NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
    @objc private func checkDaily() { model.refreshDaily() }
    @objc private func forceRefresh() { model.refreshDaily(force: true) }
    @objc private func spaceChanged() { model.reapplyToActiveSpace() }
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
