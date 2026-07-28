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
    private let handPoseRequest = VNDetectHumanHandPoseRequest()
    private let bodyPoseRequest = VNDetectHumanBodyPoseRequest()
    private let faceRequest = VNDetectFaceLandmarksRequest()

    public init() {
        handPoseRequest.maximumHandCount = 2
    }

    /// Runs all three Vision requests on a single BGRA pixel buffer.
    /// Vision automatically dispatches to ANE/GPU/CPU based on model and
    /// hardware availability -- no manual execution-provider selection needed.
    public func detect(pixelBuffer: CVPixelBuffer) -> String {
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        do {
            try handler.perform([handPoseRequest, bodyPoseRequest, faceRequest])
        } catch {
            return "{\"error\":\"\(error.localizedDescription)\"}"
        }

        var hands: [[String: Any]] = []
        for observation in handPoseRequest.results ?? [] {
            if let points = try? observation.recognizedPoints(.all) {
                let kps = points.values.map { pt -> [String: Any] in
                    ["x": pt.location.x, "y": 1 - pt.location.y, "confidence": pt.confidence]
                }
                hands.append(["keypoints": kps, "confidence": observation.confidence])
            }
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

        var faces: [[String: Any]] = []
        for observation in faceRequest.results ?? [] {
            let bb = observation.boundingBox
            faces.append(["x": bb.origin.x, "y": 1 - bb.origin.y - bb.height, "width": bb.width, "height": bb.height, "confidence": observation.confidence])
        }

        let payload: [String: Any] = ["hands": hands, "bodies": bodies, "faces": faces]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return "{\"error\":\"serialization_failed\"}"
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
        memcpy(dest, bytes, Int(height) * Int(bytesPerRow))
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])

    let json = sharedEngine.detect(pixelBuffer: buffer)
    return strdup(json)
}

@_cdecl("vision_bridge_free_string")
public func vision_bridge_free_string(_ ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}
