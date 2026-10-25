// Run with `swift scripts/render-icon.swift` on macOS to refresh the PNG icons.
import AppKit

guard let image = NSImage(contentsOfFile: "app-icon.png") else {
    fatalError("Missing app-icon.png")
}

for size in [32, 180, 192, 512] {
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
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size),
               from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()

    let name = "app-icon-\(size).png"
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Could not encode \(name)")
    }
    try data.write(to: URL(fileURLWithPath: name))
}
