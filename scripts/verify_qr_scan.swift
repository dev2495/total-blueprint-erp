// Independent scan verification using the macOS Vision QR detector.
import Foundation
import AppKit
import Vision

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: verify_qr_scan <expected-url> <image-path> [image-path...]\n", stderr)
    exit(2)
}
let expected = CommandLine.arguments[1]
var failures = 0
for path in CommandLine.arguments.dropFirst(2) {
    guard let input = NSImage(contentsOfFile: path),
          let image = input.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("FAIL image could not be read: \(path)")
        failures += 1
        continue
    }
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    do {
        try VNImageRequestHandler(cgImage: image).perform([request])
        let matches = request.results?.compactMap { $0.payloadStringValue } ?? []
        let passed = matches.contains(expected)
        print("\(passed ? "PASS" : "FAIL") \(path): \(matches.count) QR codes, expected URL \(passed ? "decoded" : "absent")")
        if !passed { failures += 1 }
    } catch {
        print("FAIL detector error: \(path)")
        failures += 1
    }
}
exit(failures == 0 ? 0 : 1)
