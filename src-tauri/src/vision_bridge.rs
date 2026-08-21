// FFI bridge to the native Swift VisionBridge static library.
// Vision/CoreML requests here run on the Apple Neural Engine automatically
// when available (macOS decides ANE vs GPU vs CPU per-model internally).

use std::ffi::{c_char, CStr};
use std::os::raw::c_int;

#[cfg(target_os = "macos")]
extern "C" {
    fn vision_bridge_detect_bgra(
        bytes: *const u8,
        width: c_int,
        height: c_int,
        bytes_per_row: c_int,
    ) -> *mut c_char;
    fn vision_bridge_free_string(ptr: *mut c_char);
}

#[cfg(target_os = "macos")]
pub fn detect_frame(bgra: &[u8], width: i32, height: i32, bytes_per_row: i32) -> String {
    unsafe {
        let ptr = vision_bridge_detect_bgra(bgra.as_ptr(), width, height, bytes_per_row);
        if ptr.is_null() {
            return "{\"error\":\"native_call_failed\"}".to_string();
        }
        let result = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        vision_bridge_free_string(ptr);
        result
    }
}

#[cfg(not(target_os = "macos"))]
pub fn detect_frame(_bgra: &[u8], _width: i32, _height: i32, _bytes_per_row: i32) -> String {
    "{\"error\":\"unsupported_platform\"}".to_string()
}

#[tauri::command]
pub fn detect_vision_frame(
    bgra: Vec<u8>,
    width: i32,
    height: i32,
    bytes_per_row: i32,
) -> serde_json::Value {
    // The Swift bridge already returns a JSON string. Parsing it here once
    // and returning a real serde_json::Value lets Tauri's IPC layer
    // serialize a structured object directly, instead of the JS side having
    // to JSON.parse() a string that Tauri itself already JSON-encoded.
    let raw = detect_frame(&bgra, width, height, bytes_per_row);
    serde_json::from_str(&raw).unwrap_or_else(|_| {
        serde_json::json!({ "error": "invalid_json_from_native_bridge" })
    })
}
