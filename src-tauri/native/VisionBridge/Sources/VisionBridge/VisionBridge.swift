import Foundation
import Vision
import CoreImage
import CoreVideo

// MARK: - C-compatible result structs

@objc public class HandLandmark: NSObject {
    public let x: Float
    public let y: Float
    public let confidence: Float
    init(x: Float, y: Float, confidence: Float) {
        self.x = x; self.y = y; self.confidence = confidence
    }
}

// MARK: - Vision request handler (Neural Engine accelerated)

public final class VisionEngine {
    private var bodyPoseRequest = VNDetectHumanBodyPoseRequest()

    public init() {}

    /// Runs Vision body pose detection on a single BGRA pixel buffer.
    /// Vision automatically dispatches to ANE/GPU/CPU based on hardware availability.
    public func detect(pixelBuffer: CVPixelBuffer) -> String {
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        do {
            try handler.perform([bodyPoseRequest])
        } catch {
            // Re-instantiate request in case internal state is corrupted
            bodyPoseRequest = VNDetectHumanBodyPoseRequest()
            return "{\"bodies\":[],\"error\":\"\(error.localizedDescription)\"}"
        }

        var bodies: [[String: Any]] = []
        for observation in bodyPoseRequest.results ?? [] {
            if let points = try? observation.recognizedPoints(.all) {
                let kps = points.map { (key, pt) -> [String: Any] in
                    ["name": key.rawValue.rawValue, "x": pt.location.x, "y": 1 - pt.location.y, "confidence": pt.confidence]
                }
                bodies.append(["keypoints": kps, "confidence": observation.confidence])
            }
        }

        let payload: [String: Any] = ["hands": [], "bodies": bodies, "faces": []]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return "{\"bodies\":[],\"error\":\"serialization_failed\"}"
        }
        return json
    }
}

// MARK: - C ABI exports (called from Rust via FFI)

private var sharedEngine = VisionEngine()

@_cdecl("vision_bridge_detect_bgra")
public func vision_bridge_detect_bgra(
    _ bytes: UnsafePointer<UInt8>,
    _ width: Int32,
    _ height: Int32,
    _ bytesPerRow: Int32
) -> UnsafeMutablePointer<CChar>? {
    var pixelBuffer: CVPixelBuffer?
    let attrs: [CFString: Any] = [
        kCVPixelBufferCGImageCompatibilityKey: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey: true
    ]
    let status = CVPixelBufferCreate(
        kCFAllocatorDefault, Int(width), Int(height),
        kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pixelBuffer
    )
    guard status == kCVReturnSuccess, let buffer = pixelBuffer else { return nil }

    CVPixelBufferLockBaseAddress(buffer, [])
    if let dest = CVPixelBufferGetBaseAddress(buffer) {
        let destBytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        let srcBytesPerRow = Int(bytesPerRow)
        let copyBytes = min(destBytesPerRow, srcBytesPerRow)
        for row in 0..<Int(height) {
            let destPtr = dest.advanced(by: row * destBytesPerRow)
            let srcPtr = bytes.advanced(by: row * srcBytesPerRow)
            memcpy(destPtr, srcPtr, copyBytes)
        }
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])

    let json = sharedEngine.detect(pixelBuffer: buffer)
    return strdup(json)
}

@_cdecl("vision_bridge_free_string")
public func vision_bridge_free_string(_ ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}

