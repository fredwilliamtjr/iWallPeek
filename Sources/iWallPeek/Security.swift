import Foundation
import ImageIO

enum WallError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case let .invalid(message) = self { return message }; return nil }
}

enum Safety {
    static let maxImageBytes = 25 * 1024 * 1024
    static func validateURL(_ url: URL) throws {
        guard url.scheme == "https", url.user == nil, url.password == nil,
              url.port == nil || url.port == 443, let host = url.host?.lowercased(),
              (host == "res.public.onecdn.static.microsoft" || ["bing.com", "msn.com", "microsoft.com", "msn.net"].contains(where: { host == $0 || host.hasSuffix("." + $0) }))
        else { throw WallError.invalid("Endereço de imagem não autorizado.") }
    }
    static func validateImage(_ data: Data) throws {
        guard !data.isEmpty, data.count <= maxImageBytes,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) == 1,
              let type = CGImageSourceGetType(source) as String?,
              ["public.jpeg", "public.png"].contains(type),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? Int,
              let h = props[kCGImagePropertyPixelHeight] as? Int,
              w > 0, h > 0, w <= 16384, h <= 16384, w * h <= 50_000_000,
              CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCache: false] as CFDictionary) != nil
        else { throw WallError.invalid("Arquivo recebido não é uma imagem JPEG/PNG válida ou excede os limites.") }
    }
}

final class RedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, (try? Safety.validateURL(url)) != nil else {
            completionHandler(nil); return
        }
        completionHandler(request)
    }
}

final class SafeHTTP {
    private let delegate = RedirectGuard()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 90
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
    }()
    func get(_ url: URL, limit: Int) async throws -> Data {
        try Safety.validateURL(url)
        var request = URLRequest(url: url)
        request.setValue("iWallPeek/0.1", forHTTPHeaderField: "User-Agent")
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let finalURL = response.url else { throw WallError.invalid("O serviço não retornou uma resposta válida.") }
        try Safety.validateURL(finalURL)
        guard response.expectedContentLength <= Int64(limit) else {
            throw WallError.invalid("Download excede o limite permitido.")
        }
        var data = Data()
        for try await byte in bytes {
            guard data.count < limit else { throw WallError.invalid("Download excede o limite permitido.") }
            data.append(byte)
        }
        return data
    }
}
