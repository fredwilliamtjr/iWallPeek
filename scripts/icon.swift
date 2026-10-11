import AppKit
let out = CommandLine.arguments[1]
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
let rect = NSRect(x: 40, y: 40, width: 944, height: 944)
NSColor(calibratedRed: 0.08, green: 0.12, blue: 0.24, alpha: 1).setFill()
NSBezierPath(roundedRect: rect, xRadius: 210, yRadius: 210).fill()
NSColor(calibratedRed: 0.1, green: 0.75, blue: 0.85, alpha: 1).setFill()
let mountain = NSBezierPath()
mountain.move(to: NSPoint(x: 140, y: 270)); mountain.line(to: NSPoint(x: 420, y: 690))
mountain.line(to: NSPoint(x: 620, y: 400)); mountain.line(to: NSPoint(x: 755, y: 590))
mountain.line(to: NSPoint(x: 900, y: 270)); mountain.close(); mountain.fill()
NSColor(calibratedRed: 1, green: 0.75, blue: 0.25, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 670, y: 700, width: 130, height: 130)).fill()
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 100), .foregroundColor: NSColor.white]
("Peek" as NSString).draw(at: NSPoint(x: 380, y: 125), withAttributes: attrs)
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
