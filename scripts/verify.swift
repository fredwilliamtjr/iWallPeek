import Foundation
import AppKit


func XCTAssertThrowsError<T>(_ expression: @autoclosure () throws -> T) { do { _ = try expression(); fatalError("Esperava rejeição") } catch {} }
func XCTAssertNoThrow(_ expression: @autoclosure () throws -> Void) { do { try expression() } catch { fatalError("Rejeição inesperada: \(error)") } }
func XCTAssertTrue(_ value: Bool) { precondition(value) }
func XCTAssertFalse(_ value: Bool) { precondition(!value) }
@main struct SecurityTests {
    static func main() async throws {
        let tests = SecurityTests()
        try tests.testURLBoundary()
        tests.testRedirectBoundary()
        try tests.testStorageBudget()
        tests.testRejectNonImageAndOversizedPayload()
        try tests.testStorageDoesNotFollowSymlinkAndKeepsCurrent()
        try await tests.testLiveFeedsWhenExplicitlyEnabled()
        print("PASS: URLs, imagens inválidas/limites, armazenamento, retenção e symlinks")
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
    func testLiveFeedsWhenExplicitlyEnabled() async throws {
        guard ProcessInfo.processInfo.environment["IWALLPEEK_LIVE_TEST"] == "1" else { return }
        let service = WallpaperService()
        for source in Source.allCases {
            let image = try await service.fetch(source)
            let data = try await service.download(image)
            XCTAssertFalse(data.isEmpty)
            print("Feed validado: \(source.title), \(data.count) bytes, host \(image.url.host ?? "")")
        }
    }
}
