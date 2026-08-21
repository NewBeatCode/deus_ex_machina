import { invoke } from "@tauri-apps/api/core";

export interface NativeVisionResult {
  hands: { keypoints: { x: number; y: number; confidence: number }[]; confidence: number }[];
  bodies: { keypoints: { name: string; x: number; y: number; confidence: number }[]; confidence: number }[];
  faces: { x: number; y: number; width: number; height: number; confidence: number }[];
  error?: string;
}

/**
 * Sends a single BGRA video frame to the Rust/Swift VisionBridge, which runs
 * Vision framework requests on the Apple Neural Engine (ANE-accelerated,
 * see VisionBridge.swift). Used for body pose detection only — hands and face
 * continue to use ml5 HandPose / FaceMesh for their richer data formats.
 */
export async function detectNativeVisionFrame(
  bgra: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number
): Promise<NativeVisionResult> {
  // Pass the typed array directly -- Tauri's IPC layer accepts Uint8Array
  // natively. Array.from() previously boxed ~76,800 numbers into a plain JS
  // array on every call (~10 Hz), which defeated the whole point of the
  // pre-allocated bgraBuffer reuse pattern upstream in UnifiedVisionWrapper.
  //
  // The Rust command now parses the native JSON once and returns a real
  // structured value, so invoke() deserializes it directly -- no more
  // JSON.parse() on a string that was already JSON-encoded once by Tauri.
  return invoke<NativeVisionResult>("detect_vision_frame", {
    bgra,
    width,
    height,
    bytesPerRow,
  });
}
