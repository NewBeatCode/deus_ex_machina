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
  const raw = await invoke<string>("detect_vision_frame", {
    bgra: Array.from(bgra),
    width,
    height,
    bytesPerRow,
  });
  return JSON.parse(raw);
}
