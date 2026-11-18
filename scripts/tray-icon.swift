import AppKit
// Gera o template icon da barra de menus do macOS (preto + alfa) a partir do
// SF Symbol usado pela versão Swift: photo.on.rectangle.angled.
let out = CommandLine.arguments[1]
let px = CGFloat(Double(CommandLine.arguments[2]) ?? 18)
let config = NSImage.SymbolConfiguration(pointSize: px * 0.78, weight: .regular)
let symbol = NSImage(systemSymbolName: "photo.on.rectangle.angled", accessibilityDescription: nil)!.withSymbolConfiguration(config)!
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(px), pixelsHigh: Int(px), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let s = symbol.size
let scale = min(px / s.width, px / s.height)
let w = s.width * scale, h = s.height * scale
let rect = NSRect(x: (px - w) / 2, y: (px - h) / 2, width: w, height: h)
symbol.draw(in: rect)
NSColor.black.set()
rect.fill(using: .sourceAtop)
NSGraphicsContext.restoreGraphicsState()
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
