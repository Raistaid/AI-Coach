// Run with `swift scripts/render-icon.swift` on macOS to refresh the PNG icons.
import AppKit

for size in [180, 192, 512] {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Could not create icon bitmap")
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    context.shouldAntialias = true
    let transform = NSAffineTransform()
    transform.translateX(by: 0, yBy: CGFloat(size))
    transform.scaleX(by: CGFloat(size) / 512, yBy: -CGFloat(size) / 512)
    transform.concat()

    let tile = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 512, height: 512), xRadius: 116, yRadius: 116)
    NSGradient(starting: NSColor(srgbRed: 45/255, green: 136/255, blue: 1, alpha: 1),
               ending: NSColor(srgbRed: 7/255, green: 89/255, blue: 214/255, alpha: 1))!
        .draw(in: tile, angle: -45)

    let letter = NSBezierPath()
    letter.windingRule = .evenOdd
    letter.move(to: NSPoint(x: 215, y: 118))
    for (x, y) in [(297,118), (418,394), (340,394), (318,340), (194,340), (172,394), (94,394)] {
        letter.line(to: NSPoint(x: x, y: y))
    }
    letter.close()
    letter.move(to: NSPoint(x: 256, y: 187))
    letter.line(to: NSPoint(x: 217, y: 284))
    letter.line(to: NSPoint(x: 295, y: 284))
    letter.close()
    NSColor.white.setFill()
    letter.fill()
    NSGraphicsContext.restoreGraphicsState()

    let name = "app-icon-\(size).png"
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Could not encode \(name)")
    }
    try data.write(to: URL(fileURLWithPath: name))
}
