import Foundation
import AppKit


func XCTAssertThrowsError<T>(_ expression: @autoclosure () throws -> T) { do { _ = try expression(); fatalError("Esperava rejeição") } catch {} }
func XCTAssertNoThrow(_ expression: @autoclosure () throws -> Void) { do { try expression() } catch { fatalError("Rejeição inesperada: \(error)") } }
func XCTAssertTrue(_ value: Bool, file: StaticString = #file, line: UInt = #line) { precondition(value, "Falhou", file: file, line: line) }
func XCTAssertFalse(_ value: Bool, file: StaticString = #file, line: UInt = #line) { precondition(!value, "Falhou", file: file, line: line) }
@main struct SecurityTests {
    @MainActor static func main() async throws {
        let tests = SecurityTests()
        try tests.testURLBoundary()
        tests.testRedirectBoundary()
        try tests.testStorageBudget()
        try tests.testWallpaperIndexPreservesFourSpaces()
        try tests.testExportDoesNotOverwrite()
        try tests.testPreferencesAreIndependent()
        tests.testRejectNonImageAndOversizedPayload()
        try tests.testStorageDoesNotFollowSymlinkAndKeepsCurrent()
        try await tests.testLiveFeedsWhenExplicitlyEnabled()
        print("PASS: rede segura, imagens, cache, retenção, exportação, preferências e transformação global das quatro mesas")
    }
    func testURLBoundary() throws {
        for address in ["https://res.public.onecdn.static.microsoft/a", "https://www.bing.com/a", "https://assets.msn.com/a", "https://img-s-msn-com.akamaized.net/a"] {
            if address.contains("akamaized") { XCTAssertThrowsError(try Safety.validateURL(URL(string: address)!)) }
            else { XCTAssertNoThrow(try Safety.validateURL(URL(string: address)!)) }
        }
        for address in ["http://www.bing.com/a", "file:///etc/passwd", "https://bing.com.evil.test/a", "https://evilbing.com/a", "https://user:password@bing.com/a", "https://bing.com:8080/a", "https://127.0.0.1/a"] {
            XCTAssertThrowsError(try Safety.validateURL(URL(string: address)!))
        }
    }
    func testRedirectBoundary() {
        let delegate = RedirectGuard()
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let task = session.dataTask(with: URL(string: "https://www.bing.com/")!)
        let response = HTTPURLResponse(url: URL(string: "https://www.bing.com/")!, statusCode: 302, httpVersion: nil, headerFields: nil)!
        var rejected = false
        delegate.urlSession(session, task: task, willPerformHTTPRedirection: response,
            newRequest: URLRequest(url: URL(string: "https://evil.test/payload")!)) { rejected = $0 == nil }
        XCTAssertTrue(rejected)
        var accepted = false
        delegate.urlSession(session, task: task, willPerformHTTPRedirection: response,
            newRequest: URLRequest(url: URL(string: "https://www.bing.com/image.jpg")!)) { accepted = $0 != nil }
        XCTAssertTrue(accepted)
    }
    func testStorageBudget() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        var files: [URL] = []
        for index in 0..<2 {
            let file = base.appendingPathComponent(UUID().uuidString + ".jpg")
            _ = FileManager.default.createFile(atPath: file.path, contents: nil)
            let handle = try FileHandle(forWritingTo: file)
            try handle.truncate(atOffset: 260 * 1024 * 1024); try handle.close()
            try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(Double(index - 2))], ofItemAtPath: file.path)
            files.append(file)
        }
        try ImageStore(root: base).prune(keeping: files[1], days: 30)
        XCTAssertFalse(FileManager.default.fileExists(atPath: files[0].path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: files[1].path))
    }
    func testRejectNonImageAndOversizedPayload() {
        XCTAssertThrowsError(try Safety.validateImage(Data("<html>oops</html>".utf8)))
        XCTAssertThrowsError(try Safety.validateImage(Data(count: Safety.maxImageBytes + 1)))
    }
    func testStorageDoesNotFollowSymlinkAndKeepsCurrent() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        let real = base.appendingPathComponent("real")
        try FileManager.default.createDirectory(at: real, withIntermediateDirectories: true)
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        let data = bitmap.representation(using: .png, properties: [:])!
        let store = ImageStore(root: real)
        let old = try store.save(data)
        try FileManager.default.setAttributes([.modificationDate: Date.distantPast], ofItemAtPath: old.path)
        let current = try store.save(data)
        let unrelated = real.appendingPathComponent("personal.txt")
        try Data("preserve".utf8).write(to: unrelated)
        try store.prune(keeping: current, days: 7)
        XCTAssertFalse(FileManager.default.fileExists(atPath: old.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: current.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
        let link = base.appendingPathComponent("linked")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: real)
        XCTAssertThrowsError(try ImageStore(root: link).save(data))
    }
    func testWallpaperIndexPreservesFourSpaces() throws {
        let spaces = ["mesa1": ["Desktop": "original1"], "mesa2": ["Desktop": "original2"],
                      "mesa3": ["Desktop": "original3"], "mesa4": ["Desktop": "original4"]]
        let fixture: [String: Any] = ["Spaces": spaces, "Displays": ["display1": ["keep": true]],
            "AllSpacesAndDisplays": ["Idle": ["keep": "screensaver"], "Type": "individual"], "unrelated": "preserve"]
        let original = try PropertyListSerialization.data(fromPropertyList: fixture, format: .binary, options: 0)
        let image = URL(fileURLWithPath: "/tmp/foto com espaço e aspas \"日本.jpg")
        let changed = try WallpaperIndex.updated(original, image: image)
        let result = try PropertyListSerialization.propertyList(from: changed, options: [], format: nil) as! [String: Any]
        XCTAssertTrue(NSDictionary(dictionary: result["Spaces"] as! [String: Any]).isEqual(to: spaces))
        XCTAssertTrue(result["unrelated"] as? String == "preserve")
        XCTAssertTrue(NSDictionary(dictionary: result["Displays"] as! [String: Any]).isEqual(to: fixture["Displays"] as! [String: Any]))
        let global = result["AllSpacesAndDisplays"] as! [String: Any]
        XCTAssertTrue((global["Idle"] as? [String: String])?["keep"] == "screensaver")
        let content = (global["Desktop"] as! [String: Any])["Content"] as! [String: Any]
        let choice = (content["Choices"] as! [[String: Any]])[0]
        let config = try PropertyListSerialization.propertyList(from: choice["Configuration"] as! Data, options: [], format: nil) as! [String: Any]
        XCTAssertTrue((config["url"] as? [String: String])?["relative"] == image.absoluteString)
        let unknown = try PropertyListSerialization.data(fromPropertyList: ["unknown": true], format: .binary, options: 0)
        XCTAssertThrowsError(try WallpaperIndex.updated(unknown, image: image))
        var nullFixture = fixture; nullFixture["AllSpacesAndDisplays"] = "$null"
        let nullData = try PropertyListSerialization.data(fromPropertyList: nullFixture, format: .binary, options: 0)
        _ = try WallpaperIndex.updated(nullData, image: image)
    }
    func testExportDoesNotOverwrite() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        let data = bitmap.representation(using: .png, properties: [:])!
        let image = DailyImage(url: URL(string: "https://www.bing.com/test")!, title: "../evil", date: "../20261011", source: .bing, market: "pt-BR")
        let target = try Exporter.write(data, image: image, folder: base)
        XCTAssertTrue(target.deletingLastPathComponent().path == base.path)
        XCTAssertTrue(try Exporter.write(data, image: image, folder: base) == target)
        try Data("personal file".utf8).write(to: target)
        XCTAssertThrowsError(try Exporter.write(data, image: image, folder: base))
        XCTAssertTrue(try Data(contentsOf: target) == Data("personal file".utf8))
        try FileManager.default.removeItem(at: target)
        let other = base.appendingPathComponent("private.txt")
        try Data("keep".utf8).write(to: other)
        try FileManager.default.createSymbolicLink(at: target, withDestinationURL: other)
        XCTAssertThrowsError(try Exporter.write(data, image: image, folder: base))
        XCTAssertTrue(try Data(contentsOf: other) == Data("keep".utf8))
    }
    @MainActor func testPreferencesAreIndependent() throws {
        let suite = "iWallPeek-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("spotlight", forKey: "source")
        defaults.set("/one", forKey: "folderLabel.bing")
        defaults.set("/two", forKey: "folderLabel.spotlight")
        let model = WallModel(defaults: defaults, store: ImageStore(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)))
        model.autoBing = true; model.autoSpotlight = false; model.region = "en-US"
        XCTAssertTrue(defaults.bool(forKey: "auto.bing"))
        XCTAssertFalse(defaults.bool(forKey: "auto.spotlight"))
        XCTAssertTrue(defaults.string(forKey: "bingRegion") == "en-US")
        XCTAssertTrue(model.source == .spotlight && model.folderBing == "/one" && model.folderSpotlight == "/two")
        XCTAssertTrue(WallpaperService.market("en-US") == "en-US")
        XCTAssertTrue(WallpaperService.market("../../evil").contains("-"))
    }
    func testLiveFeedsWhenExplicitlyEnabled() async throws {
        guard ProcessInfo.processInfo.environment["IWALLPEEK_LIVE_TEST"] == "1" else { return }
        let service = WallpaperService()
        for market in ["pt-BR", "en-US"] {
            let history = try await service.catalog(.bing, region: market, history: true)
            XCTAssertTrue(history.count > 1 && history.count <= 8)
            XCTAssertTrue(history.allSatisfy { $0.market == market && $0.source == .bing })
            print("Histórico Bing \(market): \(history.count) imagens")
        }
        for source in Source.allCases {
            let image = try await service.fetch(source)
            let data = try await service.download(image)
            XCTAssertFalse(data.isEmpty)
            print("Feed validado: \(source.title), \(data.count) bytes, host \(image.url.host ?? "")")
        }
    }
}
