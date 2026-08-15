# Deus Ex Machina

An interactive, camera-driven cellular-automata artwork for macOS. **Deus Ex Machina** combines Conway’s Game of Life, p5.js rendering, hand and face interaction, body-pose tracking, and an optional native Apple Vision pipeline in a Tauri desktop application.

## Features

- Full-screen interactive Game of Life simulation
- Live webcam input rendered through a monochrome visual system
- Gesture-based interaction using hand-pose tracking
- Face tracking and optional COCO-SSD object detection
- Apple Vision body-pose detection in the macOS desktop build
- Native Swift Vision bridge called from Tauri/Rust
- Configurable grid size, pattern presets, detection mode, and render frame rate
- Terminal-style startup loader and live simulation diagnostics

## Stack

| Layer                 | Technology                          |
| --------------------- | ----------------------------------- |
| Desktop shell         | Tauri 2                             |
| Frontend              | React 19, TypeScript, Vite 8        |
| Styling               | Tailwind CSS 4                      |
| Generative simulation | p5.js                               |
| Native macOS vision   | Swift, Vision, CoreVideo, CoreImage |
| Native bridge         | Rust FFI and Tauri commands         |

## Requirements

### macOS application build

- macOS 12 or later
- Node.js 22+ and npm
- Rust toolchain
- Apple Swift toolchain or Xcode Command Line Tools
- A webcam and camera permission for the application

The native Vision bridge targets macOS only. The browser development build uses web-based fallbacks where available.

## Install

```bash
npm install
```

## Development

### Browser frontend

```bash
npm run dev
```

Open the URL printed by Vite, normally:

```text
http://localhost:5173
```

### Native macOS application

```bash
npm run tauri dev
```

This starts Vite and launches the Tauri application. Grant camera access when macOS asks for permission.

## Build

### Frontend bundle

```bash
npm run build
```

### macOS application bundle

```bash
npm run tauri build
```

The Tauri build runs the frontend build first and produces the macOS distributable under:

```text
src-tauri/target/release/bundle/
```

## Quality checks

```bash
npm run lint
npm run build
```

`npm run build` runs TypeScript project builds before creating the Vite production bundle.

## Interaction and settings

Use the settings control in the lower-right corner to adjust:

- **Grid size** — pixel size of each simulation cell
- **Pattern preset** — initial Game of Life configuration
- **Object detection** — optional COCO-SSD common-object detection
- **Render frame rate** — target visual update rate

The application uses camera-derived pose and landmark data to inject or influence activity in the cellular automaton.

## Apple Vision pipeline

In the Tauri macOS build, `components/nativeVision.ts` sends a BGRA camera frame to the `detect_vision_frame` Tauri command. Rust forwards the frame through FFI to `src-tauri/native/VisionBridge`, where Swift’s Vision framework performs pose analysis and returns JSON landmarks to the React layer.

The native pose scheduler is intended for body pose. Hand and face detection remain available through the web model pipeline.

To reduce power consumption, native Vision should pause whenever ML/vision processing is paused. The native interval should also be cleared when pausing detection and when the component unmounts.

## Project layout

```text
components/
  UnifiedVisionWrapper.tsx  Main camera, p5, vision, and rendering orchestration
  GameOfLife.ts             Cellular automaton implementation
  GoLIndex.tsx              Game of Life utilities
  SettingsModal.tsx         Runtime controls
  TerminalLoader.tsx        Startup experience
  nativeVision.ts           Tauri API adapter for native Vision
  presets/                  RLE and Hashlife pattern support

src/
  App.tsx                   Application composition
  main.tsx                  React entry point

src-tauri/
  src/vision_bridge.rs      Rust FFI and Tauri command
  native/VisionBridge/      Swift Vision framework bridge
  tauri.conf.json           Tauri application configuration
```

## Notes for contributors

- Keep generated output out of commits: `dist/`, `src-tauri/target/`, and `src-tauri/native/VisionBridge/.build/` are ignored.
- Treat `UnifiedVisionWrapper.tsx` as the orchestration boundary; move reusable logic into focused hooks or modules rather than increasing this component further.
- Avoid updating React state at camera or inference frequency. Keep high-rate vision data in refs and publish throttled UI or statistics snapshots.
- Clean up p5 instances, camera tracks, timers, and inference scheduling when the component unmounts.
- Prefer pausing and clearing native Vision scheduling rather than allowing background pose analysis to continue while visual ML processing is paused.

## License

Atelier Angel Karagiozov © 2026. All rights reserved.
