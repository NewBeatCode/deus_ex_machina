"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useRef, useState } from "react";
import type p5 from "p5";
import { TerminalLoader, type LoadingStep } from "./TerminalLoader";
import { Grid } from "./GameOfLife";

// ============================================================================
// Configuration
// ============================================================================
const CONFIG = {
  // Video capture resolution (internal, not display size)
  video: { width: 640, height: 480, flipped: true },
  // Cell size is fixed, grid dimensions will be calculated from window size
  cellSize: 4, // pixels per cell (increased from 2 for perf)
  frameRate: 10, // Target frame rafte
  colors: {
    light: "#ffffff",
    dark: "#000000",
    accent: ["#f3a712", "#8B728E", "#EF5B5B", "#20A39E"],
  },
} as const;

// ============================================================================
// Main Component
// ============================================================================
export interface VisionSettings {
  gridSize: number;
  seed: string;
  objectDetection: boolean;
  renderFrameRate: number;
}

export const UnifiedVisionWrapper = ({
  settings = {
    gridSize: 4,
    seed: "Random",
    objectDetection: false,
    renderFrameRate: 15,
  },
}: {
  settings?: VisionSettings;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const p5Ref = useRef<p5 | null>(null);

  // Ref to access settings inside p5 closure without re-init
  const settingsRef = useRef(settings);
  // Trigger grid rebuild/reset if needed
  const needsResetRef = useRef(false);

  // ML detection pause/resume
  const [mlPaused, setMlPaused] = useState(false);
  const mlPausedRef = useRef(false);
  // Exposed by the p5 sketch so React can call stop/start on the models
  const mlControlRef = useRef<{
    pause: () => void;
    resume: () => void;
  } | null>(null);

  useEffect(() => {
    const prev = settingsRef.current;
    if (prev.gridSize !== settings.gridSize || prev.seed !== settings.seed) {
      needsResetRef.current = true;
    }
    settingsRef.current = settings;
  }, [settings]);

  // Stats state
  const [stats, setStats] = useState({
    fps: "0",
    cells: 0,
    faces: 0,
    hands: 0,
    bodies: 0,
    objects: 0,
    uptime: "0",
    simulation: {
      generation: 0,
      density: "0",
      peakPop: 0,
      avgPop: 0,
      rule: "B3/S23",
      seed: "Random",
    },
    styles: {
      stability: "active",
      period: 0,
    },
    interaction: {
      injections: 0,
      simSpeed: 0,
      lastGesture: "none",
      interactionRate: 0,
    },
    confidence: {
      faces: 0,
      hands: 0,
      bodies: 0,
    },
  });
  const [isLoaded, setIsLoaded] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const startTimeRef = useRef(Date.now());

  // Loading steps state
  const [loadingSteps, setLoadingSteps] = useState<LoadingStep[]>([
    { id: "system", label: "System", status: "pending" },
    { id: "gameoflife", label: "Grid", status: "pending" },
    { id: "ml5", label: "ML5", status: "pending" },
    { id: "movenet", label: "BodyPose", status: "pending" },
    { id: "handpose", label: "HandPose", status: "pending" },
    { id: "facemesh", label: "FaceMesh", status: "pending" },
  ]);

  // Helper to update step status
  const updateStepStatus = (id: string, status: LoadingStep["status"]) => {
    setLoadingSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, status } : step)),
    );
  };

  useEffect(() => {
    if (typeof window === "undefined" || initializedRef.current) return;
    initializedRef.current = true;

    let isMounted = true;
    let checkMl5: ReturnType<typeof setInterval>;
    // Native body pose polling interval (hoisted so cleanup return can clear it)
    let nativePoseInterval: ReturnType<typeof setInterval> | null = null;
    const isTauri = !!(window as any).__TAURI__;

    // Inject ml5 script for Vite (non-Next) if not already loaded
    if (typeof window !== "undefined" && !(window as any).ml5) {
      const ml5Script = document.createElement("script");
      ml5Script.src = "https://unpkg.com/ml5@1.3.1/dist/ml5.min.js";
      ml5Script.async = true;
      document.head.appendChild(ml5Script);
    }

    const checkCameraAndInit = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        if (isMounted) {
          setCameraError(
            "[browser] NotAllowedError: Permission denied by system",
          );
        }
      }

      if (!isMounted) return;
      checkMl5 = setInterval(() => {
        if ((window as any).ml5 && isMounted) {
          clearInterval(checkMl5);
          // Force WebGL backend to avoid WebGPU sync warnings
          if ((window as any).tf) {
            (window as any).tf.setBackend("webgl").then(() => initSketch());
          } else {
            initSketch();
          }
        }
      }, 100);
    };

    checkCameraAndInit();

    async function initSketch() {
      if (!isMounted) return;

      // Import from package entry (let Vite pre-bundle `p5`)
      const P5 = (await import("p5")).default;
      if (!isMounted) return;

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const sketch = (p: p5) => {
        // Shared state
        let video: any;
        let grid: Grid;

        // ML models
        let faceMesh: any;
        let handPose: any;
        let objectDetector: any;
        // nativePoseInterval and isTauri are declared at the useEffect body level
        // so the cleanup return function can access them.

        // Apple Vision joint name → flat array index (matches MoveNet order).
        // VNHumanBodyPoseObservation key raw-value strings are camelCase via rawValue.
        const APPLE_JOINT_INDEX: Record<string, number> = {
          nose: 0, leftEye: 1, rightEye: 2, leftEar: 3, rightEar: 4,
          leftShoulder: 5, rightShoulder: 6,
          leftElbow: 7, rightElbow: 8,
          leftWrist: 9, rightWrist: 10,
          leftHip: 11, rightHip: 12,
          leftKnee: 13, rightKnee: 14,
          leftAnkle: 15, rightAnkle: 16,
          // aliases Vision may return
          left_shoulder_1_joint: 5, right_shoulder_1_joint: 6,
          left_forearm_joint: 7, right_forearm_joint: 8,
          left_hand_joint: 9, right_hand_joint: 10,
          left_upLeg_joint: 11, right_upLeg_joint: 12,
          left_leg_joint: 13, right_leg_joint: 14,
          left_foot_joint: 15, right_foot_joint: 16,
          head_joint: 0, neck_joint: 6,
        };
        // Skeleton edge pairs using same indices (mirrors MoveNet getSkeleton output)
        const APPLE_BODY_SKELETON: [number, number][] = [
          [5, 7], [7, 9], [6, 8], [8, 10],   // arms
          [5, 6],                               // shoulders
          [5, 11], [6, 12],                    // torso sides
          [11, 12],                             // hips
          [11, 13], [13, 15], [12, 14], [14, 16], // legs
          [0, 1], [0, 2], [1, 3], [2, 4],     // face
        ];

        // Detection results
        let faces: any[] = [];
        let poses: any[] = [];
        let rawHands: any[] = [];
        let hands: any[] = [];
        let objects: any[] = [];

        // HUD Stats Tracking
        let peakPopulation = 0;
        let totalPopulationSum = 0;
        let totalGenerationsSampled = 0;
        let injectionCount = 0;
        let lastGestureName = "none";
        let objectDetectorLoading = false;
        const creationTime = Date.now();
        let nextHandId = 1;
        let activeNavHandId: number | null = null;

        // Hand Stability Manager
        const handTracker = {
          smoothed: [] as any[],
          maxPersistence: 10,
          smoothingFactor: 0.7,

          update(newDetected: any[]) {
            this.smoothed.forEach((h: any) => h.framesLost++);
            const usedSmoothed = new Set<any>();
            for (const hand of newDetected) {
              if (hand.confidence < 0.5) continue;
              const wrist = hand.keypoints[0];
              let bestMatch: any = null;
              let minDist = Infinity;
              for (const sh of this.smoothed) {
                if (usedSmoothed.has(sh)) continue;
                // Prevent cross-hand matching (important when hands are close)
                if (
                  sh.handedness &&
                  hand.handedness &&
                  sh.handedness !== hand.handedness
                ) continue;
                const shWrist = sh.keypoints[0];
                const d = p.dist(wrist.x, wrist.y, shWrist.x, shWrist.y);
                if (d < minDist) {
                  minDist = d;
                  bestMatch = sh;
                }
              }
              if (bestMatch) {
                usedSmoothed.add(bestMatch);
                const wasLost = bestMatch.framesLost > 1;
                bestMatch.framesLost = 0;
                bestMatch.confidence = hand.confidence;
                bestMatch.handedness = hand.handedness;

                if (wasLost) {
                  // On reacquisition, snap keypoints to the new detection
                  // instead of lerping from stale frozen positions.
                  // Square is hidden during lost frames, so no visual jump,
                  // and this "reinitializes" the position fresh like at start.
                  bestMatch.prev_palm_x = hand.keypoints[9].x;
                  bestMatch.prev_palm_y = hand.keypoints[9].y;
                  for (let i = 0; i < hand.keypoints.length; i++) {
                    bestMatch.keypoints[i].x = hand.keypoints[i].x;
                    bestMatch.keypoints[i].y = hand.keypoints[i].y;
                  }
                } else {
                  // Normal smoothing for continuous tracking
                  bestMatch.prev_palm_x = bestMatch.keypoints[9].x;
                  bestMatch.prev_palm_y = bestMatch.keypoints[9].y;
                  for (let i = 0; i < hand.keypoints.length; i++) {
                    bestMatch.keypoints[i].x = p.lerp(
                      bestMatch.keypoints[i].x,
                      hand.keypoints[i].x,
                      this.smoothingFactor,
                    );
                    bestMatch.keypoints[i].y = p.lerp(
                      bestMatch.keypoints[i].y,
                      hand.keypoints[i].y,
                      this.smoothingFactor,
                    );
                  }
                }

                bestMatch.index_finger_tip = bestMatch.keypoints[8];
                bestMatch.thumb_tip = bestMatch.keypoints[4];
              } else {
                const newSH = {
                  id: nextHandId++,
                  keypoints: hand.keypoints.map((k: any) => ({ ...k })),
                  confidence: hand.confidence,
                  handedness: hand.handedness,
                  framesLost: 0,
                  index_finger_tip: null,
                  thumb_tip: null,
                  prev_palm_x: hand.keypoints[9].x,
                  prev_palm_y: hand.keypoints[9].y,
                };
                newSH.index_finger_tip = newSH.keypoints[8];
                newSH.thumb_tip = newSH.keypoints[4];
                this.smoothed.push(newSH);
              }
            }
            this.smoothed = this.smoothed.filter(
              (h: any) => h.framesLost < this.maxPersistence,
            );
          },
        };

        let triangles: any[] = [];
        let skeletonConnections: any[] = [];
        let wasPinching = false;

        // Triangle flash: a short-lived record of the triangle shape + apex,
        // frozen in screen space at the moment cells are created, rendered
        // independently for TRIANGLE_FLASH_DURATION ms with fading alpha.
        // The "+N cells" label is drawn attached to the apex via a connector
        // stem so it reads as one object with the triangle, not a floating
        // separate label over the Game of Life canvas.
        const triangleFlashes: any[] = [];
        const TRIANGLE_FLASH_DURATION = 1500; // 1000ms hold + 500ms fade
        const TRIANGLE_HOLD_DURATION = 1000;
        const TRIANGLE_FADE_DURATION = 500;
        let handjetFont: any = null; // loaded locally in p.setup() via p.loadFont()

        // Pan physics: two phases.
        // 1) DRAG phase -- an underdamped elastic spring (zeta = 0.65) pulls the rendered pan
        //    position toward the hand's raw target every frame. On direction changes, inertia
        //    momentum carries the motion forward initially while the spring stretches, before
        //    elastically curving back to track the moving hand.
        // 2) THROW phase -- on release, physical velocity blended with sampled hand velocity
        //    carries the pan forward and decays under exponential friction.
        let panTargetX = 0; // where the hand is pulling the grid to (accumulated)
        let panTargetY = 0;
        let panVelX = 0; // current pan velocity, px/sec (spring OR throw phase)
        let panVelY = 0;
        const SPRING_STIFFNESS = 200; // responsive follow with elastic spring easing
        const SPRING_DAMPING_RATIO = 0.65; // underdamped (zeta < 1.0) for elastic spring-back
        const SPRING_DAMPING = 2 * SPRING_DAMPING_RATIO * Math.sqrt(SPRING_STIFFNESS);
        const THROW_FRICTION = 0.05; // fraction of velocity retained per second (lower = stops sooner)
        const THROW_VEL_MIN = 4; // px/sec threshold to end the throw
        let isThrowing = false;
        let wasActivelyDragging = false;
        let lastFrameMs = performance.now();

        // Rolling velocity sample, measured from real hand displacement
        // while dragging -- used to seed/blend the throw phase on release.
        let sampleVelX = 0;
        let sampleVelY = 0;
        const VEL_SAMPLE_SMOOTH = 0.25;
        const effects: any[] = [];
        // Track last-set FPS so we avoid calling the p.frameRate() getter every frame.
        let lastSetFps = mlPausedRef.current
          ? 5
          : (settingsRef.current.renderFrameRate || 15);

        class PinchEffect {
          x: number;
          y: number;
          count: number;
          alpha: number;
          yOff: number;
          constructor(x: number, y: number, count: number) {
            this.x = x;
            this.y = y;
            this.count = count;
            this.alpha = 255;
            this.yOff = 0;
          }
          update() {
            this.alpha -= 4;
            this.yOff -= 1;
          }
          draw(p: p5) {
            p.push();
            // Ring pulse marking the actual cell injection point.
            // The "+N cells" label lives on the triangle flash instead, so
            // it stays visually attached to the gesture, not the grid.
            p.noFill();
            p.stroke(255, this.alpha);
            p.strokeWeight(1);
            p.circle(this.x, this.y, p.map(this.alpha, 255, 0, 0, 100));
            p.pop();
          }
        }

        let scale = 1;
        let offsetX = 0;
        let offsetY = 0;

        function updateScale() {
          const scaleX = p.windowWidth / CONFIG.video.width;
          const scaleY = p.windowHeight / CONFIG.video.height;
          scale = Math.max(scaleX, scaleY);
          const scaledW = CONFIG.video.width * scale;
          const scaledH = CONFIG.video.height * scale;
          offsetX = (p.windowWidth - scaledW) / 2;
          offsetY = (p.windowHeight - scaledH) / 2;
        }

        p.setup = async () => {
          const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
          const canvasElt = canvas.elt as HTMLElement;
          canvasElt.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            if (grid) {
              const rect = canvasElt.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              const count = grid.spawnGliderGunAt(x, y);
              effects.push(new PinchEffect(x, y, count));
            }
          });
          p.pixelDensity(1);
          p.frameRate(
            mlPausedRef.current
              ? 5
              : (settingsRef.current.renderFrameRate || 15)
          ); // initial value; kept in sync live below
          // Set font for canvas drawing
          p.textFont("IBM Plex Mono, monospace");

          // Load Handjet fully locally from /public/fonts via p.loadFont().
          // This parses the TTF directly (opentype.js) instead of relying on
          // CSS font-matching, so there's no serif fallback and no npm
          // package dependency -- the font ships with the project assets.
          try {
            handjetFont = await p.loadFont(
              "/fonts/Handjet/static/Handjet-Thin.ttf",
            );
          } catch (e) {
            console.warn("Handjet font failed to load locally:", e);
          }

            // Pool of "+N cells" icons, drawn via Path2D onto canvas context.
            // One is picked at random per triangle flash (see
            // triangleFlashes.push) and stays fixed for that flash's life.
            const cellsSvgPaths = [
              "M14 22H10V20H14V22ZM10 20H8V18H10V20ZM16 20H14V18H16V20ZM8 18H6V16H8V18ZM18 18H16V16H18V18ZM13 17H11V15H13V17ZM6 16H4V14H6V16ZM20 16H18V14H20V16ZM4 14H2V6H4V14ZM22 14H20V6H22V14ZM10 10H11V13H8V12H6V8H10V10ZM18 12H16V13H13V10H14V8H18V12ZM6 6H4V4H6V6ZM20 6H18V4H20V6ZM18 4H6V2H18V4Z",
              "M18 22H6v-2h12v2ZM6 20H4v-2h2v2Zm14 0h-2v-2h2v2ZM4 18H2V6h2v12Zm18 0h-2V6h2v12Zm-7-1H9v-2h6v2Zm-6-2H7v-2h2v2Zm8 0h-2v-2h2v2Zm-7-5H8V8h2v2Zm6 0h-2V8h2v2ZM6 6H4V4h2v2Zm14 0h-2V4h2v2Zm-2-2H6V2h12v2Z",
              "M2 5h2v4H2zm20 0h-2v4h2zM4 9h2v2H4zm16 0h-2v2h2zM2 13h4v2H2zm20 0h-4v2h4zM4 17h2v2H4zm16 0h-2v2h2zM2 19h2v2H2zm20 0h-2v2h2zM6 11h12v2H6zM6 7h2v12H6zm10 0h2v12h-2zM8 19h8v2H8zM8 5h8v2H8zM11 15h2v6h-2zM8 1h2v6H8zm6 0h2v6h-2z",
              "M18 23H10V21H12V19H14V21H16V17H18V23ZM10 15H12V19H10V17H6V15H8V13H4V11H10V15ZM20 17H18V15H20V17ZM14 15H12V13H14V15ZM22 15H20V13H18V11H20V7H22V15ZM4 7H8V9H4V11H2V3H4V7ZM18 11H16V9H18V11ZM16 9H14V3H16V9ZM12 7H10V5H12V7ZM14 3H4V1H14V3Z",
              "M17 9h-2v13h-2v-6h-2v6H9V9H7V7h10v2Zm-6 5h2V9h-2v5ZM7 7H5V5h2v2Zm12 0h-2V5h2v2Zm-5-1h-4V2h4v4ZM5 5H3V3h2v2Zm16 0h-2V3h2v2Z",
            ];
            const cellsSvgPathPool = cellsSvgPaths.map((d) => new Path2D(d));
            const drawCellsIcon = (
              iconIndex: number,
              x: number,
              y: number,
              sz: number,
              a: number,
            ) => {
              const ctx = (p as any).drawingContext as CanvasRenderingContext2D;
              if (!ctx) return;
              const iconPath = cellsSvgPathPool[iconIndex] || cellsSvgPathPool[0];
              ctx.save();
              ctx.translate(x - sz / 2, y - sz / 2);
              ctx.scale(sz / 24, sz / 24);
              ctx.fillStyle = `rgba(255, 255, 255, ${a / 255})`;
              ctx.fill(iconPath);
              ctx.restore();
            };
            (p as any)._drawCellsIcon = drawCellsIcon;
            (p as any)._cellsIconPoolSize = cellsSvgPathPool.length;

          updateScale();
          updateStepStatus("system", "completed");

          try {
            video = p.createCapture(p.VIDEO, { flipped: CONFIG.video.flipped });
            if (video) {
              video.size(CONFIG.video.width, CONFIG.video.height);
              video.hide();
            }
          } catch (e) {
            console.error("Video capture failed:", e);
          }

          // No offscreen pg buffer needed — video frames are fed directly to
          // the ML models via video.elt; we never readback pixels ourselves.

          updateStepStatus("gameoflife", "loading");
          setTimeout(() => {
            grid = new Grid(p, p.windowWidth, p.windowHeight, {
              ...CONFIG,
              cellSize: settingsRef.current.gridSize,
            });
            grid.spawnPattern(settingsRef.current.seed);
            updateStepStatus("gameoflife", "completed");
          }, 100);

          initModels();
        };

        p.mousePressed = () => {};

        p.mouseDragged = () => {
          if (grid) {
            grid.setPan(p.mouseX - p.pmouseX, p.mouseY - p.pmouseY);
          }
        };

        p.mouseReleased = () => {
          // cell creation is gesture-only (both hands triangle)
        };

        p.windowResized = () => {
          p.resizeCanvas(p.windowWidth, p.windowHeight);
          updateScale();
          grid = new Grid(p, p.windowWidth, p.windowHeight, {
            ...CONFIG,
            cellSize: settingsRef.current.gridSize,
          });
          grid.spawnPattern(settingsRef.current.seed);
        };

        async function initModels() {
          // If the app caught a camera error earlier, abort waiting for video
          if (document.querySelector("dialog[open]")) {
            updateStepStatus("ml5", "error");
            updateStepStatus("movenet", "error");
            updateStepStatus("handpose", "error");
            updateStepStatus("facemesh", "error");
            return;
          }

          if (!video?.elt || video.elt.readyState < 2) {
            setTimeout(initModels, 300);
            return;
          }
          const videoElt = video.elt;
          const ml5 = (window as any).ml5;

          try {
            updateStepStatus("ml5", "loading");
            await new Promise((resolve) => setTimeout(resolve, 100));
            updateStepStatus("ml5", "completed");

            let runNativePose: (() => Promise<void>) | null = null;

            // ── Native Apple Vision body pose (replaces MoveNet) ───────────────
            if (isTauri) {
              updateStepStatus("movenet", "loading");
              // Use a fixed skeleton — no getSkeleton() call needed
              skeletonConnections = APPLE_BODY_SKELETON;

              // Offscreen canvas for BGRA frame extraction
              const offCanvas = document.createElement("canvas");
              const offCtx = offCanvas.getContext("2d", { willReadFrequently: true });

              // Dynamic import keeps the Tauri API out of the browser bundle
              const { detectNativeVisionFrame } = await import("./nativeVision");

              let isDetecting = false;
              runNativePose = async () => {
                if (mlPausedRef.current || isDetecting || !video?.elt || video.elt.readyState < 2 || !offCtx) return;
                isDetecting = true;
                try {
                  const vw = video.elt.videoWidth  || CONFIG.video.width;
                  const vh = video.elt.videoHeight || CONFIG.video.height;
                  offCanvas.width  = vw;
                  offCanvas.height = vh;
                  offCtx.drawImage(video.elt, 0, 0, vw, vh);
                  const imgData = offCtx.getImageData(0, 0, vw, vh);
                  // ImageData is RGBA; Vision expects BGRA — swap R and B channels
                  const rgba = imgData.data;
                  const bgra = new Uint8Array(rgba.length);
                  for (let i = 0; i < rgba.length; i += 4) {
                    bgra[i]     = rgba[i + 2]; // B
                    bgra[i + 1] = rgba[i + 1]; // G
                    bgra[i + 2] = rgba[i];     // R
                    bgra[i + 3] = rgba[i + 3]; // A
                  }
                  const result = await detectNativeVisionFrame(bgra, vw, vh, vw * 4);
                  if (mlPausedRef.current) {
                    poses = [];
                    return;
                  }
                  if (result.error || !result.bodies?.length) {
                    poses = [];
                    return;
                  }
                  // Map Apple Vision bodies → poses[]
                  // Coords are normalized 0-1; scale to pixel space and flip X
                  // (Vision gives mirrored coords; video feed is already flipped)
                  poses = result.bodies.map((body: any) => {
                    // Build a 17-slot keypoints array (index matches MoveNet)
                    const kps: any[] = Array.from({ length: 17 }, () => ({
                      x: 0, y: 0, confidence: 0, name: ""
                    }));
                    for (const kp of body.keypoints) {
                      const idx = APPLE_JOINT_INDEX[kp.name];
                      if (idx !== undefined) {
                        kps[idx] = {
                          // Mirror X because Vision returns un-flipped coords
                          x: (1 - kp.x) * vw,
                          y: kp.y * vh,
                          confidence: kp.confidence,
                          name: kp.name,
                        };
                      }
                    }
                    return { keypoints: kps, confidence: body.confidence };
                  });
                } catch {
                  // IPC error — don't crash, just clear poses
                  poses = [];
                } finally {
                  isDetecting = false;
                }
              };

              nativePoseInterval = setInterval(runNativePose, 100); // ~10 Hz
              updateStepStatus("movenet", "completed");
            } else {
              // ── Browser fallback: ml5 MoveNet ────────────────────────────────
              updateStepStatus("movenet", "loading");
              const bp = await ml5.bodyPose("MoveNet", { flipped: true });
              if (bp?.getSkeleton) skeletonConnections = bp.getSkeleton();
              startDetection(bp, (r: any[]) => (poses = r));
              updateStepStatus("movenet", "completed");
            }

            // ── ml5 hand + face (unchanged) ───────────────────────────────────
            updateStepStatus("handpose", "loading");
            updateStepStatus("facemesh", "loading");

            const [hp, fm] = await Promise.all([
              ml5.handPose({
                flipped: true,
                maxHands: 2,
                runtime: "mediapipe",
                modelType: "full",
                minHandDetectionConfidence: 0.7,
                minHandPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
              }),
              ml5.faceMesh(videoElt, { maxFaces: 1, flipped: true }),
            ]);

            handPose = hp;
            startDetection(handPose, (r: any[]) => (rawHands = r));
            updateStepStatus("handpose", "completed");

            faceMesh = fm;
            triangles = extractTriangles(faceMesh);
            startDetection(faceMesh, (r: any[]) => (faces = r));
            updateStepStatus("facemesh", "completed");

            // Expose pause/resume controls to the React layer
            mlControlRef.current = {
              pause: () => {
                try { faceMesh?.detectStop?.(); } catch { /* ignore */ }
                try { handPose?.detectStop?.(); } catch { /* ignore */ }
                try { objectDetector?.detectStop?.(); } catch { /* ignore */ }
                // Stop native body pose polling (Apple Vision)
                if (nativePoseInterval !== null) {
                  clearInterval(nativePoseInterval);
                  nativePoseInterval = null;
                }
                // Stop camera hardware device completely (turns off green indicator LED)
                try {
                  const stream = (video?.elt?.srcObject as MediaStream | null) ||
                    (document.querySelector("video")?.srcObject as MediaStream | null);
                  if (stream) {
                    stream.getTracks().forEach((track) => {
                      track.stop();
                    });
                  }
                  if (video?.elt) {
                    video.elt.srcObject = null;
                    video.elt.pause();
                  }
                } catch { /* ignore */ }

                faces = [];
                poses = [];
                rawHands = [];
                hands = [];
                objects = [];
                handTracker.smoothed = [];
              },
              resume: () => {
                // Restart camera hardware capture and restart ML detectors
                const startCameraAndResume = async () => {
                  try {
                    let stream = video?.elt?.srcObject as MediaStream | null;
                    if (!stream || !stream.active || stream.getVideoTracks().length === 0) {
                      stream = await navigator.mediaDevices.getUserMedia({
                        video: {
                          width: CONFIG.video.width,
                          height: CONFIG.video.height,
                        },
                      });
                      if (video?.elt) {
                        video.elt.srcObject = stream;
                        await video.elt.play();
                      }
                    }
                  } catch (e) {
                    console.warn("Failed to re-acquire camera on resume:", e);
                  }

                  if (video?.elt && !mlPausedRef.current) {
                    try { faceMesh?.detectStart?.(video.elt, (r: any[]) => (faces = r)); } catch { /* ignore */ }
                    try { handPose?.detectStart?.(video.elt, (r: any[]) => (rawHands = r)); } catch { /* ignore */ }
                    if (settingsRef.current.objectDetection && objectDetector) {
                      try {
                        objectDetector.detectStart(video.elt, (results: any[]) => {
                          if (settingsRef.current.objectDetection) objects = results;
                        });
                      } catch { /* ignore */ }
                    }
                    // Restart native body pose polling (Apple Vision)
                    if (isTauri && runNativePose && nativePoseInterval === null) {
                      nativePoseInterval = setInterval(runNativePose, 100);
                    }
                  }
                };

                startCameraAndResume();
              },
            };
          } catch (err) {
            console.error("Error loading ML models:", err);
          }
        }

        function startDetection(
          model: any,
          callback: (results: any[]) => void,
        ) {
          if (!model?.detectStart || !model.model) {
            setTimeout(() => startDetection(model, callback), 300);
            return;
          }
          if (video?.elt?.readyState === 4) {
            model.detectStart(video.elt, callback);
          } else {
            setTimeout(() => startDetection(model, callback), 300);
          }
        }

        function extractTriangles(fm: any): any[] {
          if (typeof fm?.getTriangles === "function") return fm.getTriangles();
          if (fm?.triangles) return fm.triangles;
          if (fm?._triangles) {
            const raw = Array.from(fm._triangles) as number[];
            const chunks = [];
            for (let i = 0; i < raw.length; i += 3) {
              chunks.push([raw[i], raw[i + 1], raw[i + 2]]);
            }
            return chunks;
          }
          return [];
        }

        p.draw = () => {
          // Keep the render/interaction frame rate in sync with the live
          // settings panel value (cheap + idempotent to call every frame).
          // Avoid calling the p.frameRate() getter (which computes a rolling
          // average) on every frame. Only push a new value when it actually changed.
          const desiredFps = mlPausedRef.current
            ? 5
            : (settingsRef.current.renderFrameRate || 15);
          if (desiredFps !== lastSetFps) {
            p.frameRate(desiredFps);
            lastSetFps = desiredFps;
          }

          p.background(CONFIG.colors.dark);
          handTracker.update(rawHands);
          hands = handTracker.smoothed;

          // Check for settings updates
          if (needsResetRef.current) {
            const s = settingsRef.current;
            // Recreate grid if size changed or grid not initialized yet
            if (!grid || grid.cellSize !== s.gridSize) {
              grid = new Grid(p, p.windowWidth, p.windowHeight, {
                ...CONFIG,
                cellSize: s.gridSize,
              });
            }
            grid.spawnPattern(s.seed);

            // Dynamic COCO-SSD Loading
            if (
              s.objectDetection &&
              !objectDetector &&
              !objectDetectorLoading
            ) {
              // Initialize if enabled but not loaded
              const ml5 = (window as any).ml5;
              if (ml5 && video?.elt?.readyState === 4) {
                objectDetectorLoading = true;
                ml5
                  .objectDetection("cocossd", { flipped: true })
                  .then((od: any) => {
                    objectDetector = od;
                    objectDetector.detectStart(video.elt, (results: any[]) => {
                      if (settingsRef.current.objectDetection) {
                        objects = results;
                      } else {
                        objects = [];
                      }
                    });
                    objectDetectorLoading = false;
                  })
                  .catch((err: any) => {
                    console.error("COCO-SSD error:", err);
                    objectDetectorLoading = false;
                  });
              }
            } else if (!s.objectDetection && objectDetector) {
              objects = [];
            }

            needsResetRef.current = false;
          }

          if (grid) {
            grid.update();
            grid.draw();
          }

          // (pg buffer removed — ML models consume video.elt directly)

          p.push();
          p.translate(offsetX, offsetY);
          p.scale(scale);
          // Video feed hidden as per request
          // p.image(video, 0, 0);
          drawFaceMesh();
          drawBodyPose();
          drawObjects();
          drawHands(); // Drawn after others to be on top
          p.pop();

          // Draw feedback effects in screen space (outside video transformation)
          effects.forEach((eff, i) => {
            eff.update();
            eff.draw(p);
            if (eff.alpha <= 0) effects.splice(i, 1);
          });

          // Draw triangle flashes: persists for TRIANGLE_FLASH_DURATION ms,
          // fading out, with the "+N cells" label connected to the apex by
          // a short stem so it visually follows the triangle's top point.
          for (let i = triangleFlashes.length - 1; i >= 0; i--) {
            const tf = triangleFlashes[i];
            const elapsed = performance.now() - tf.startTime;
            if (elapsed >= TRIANGLE_FLASH_DURATION) {
              triangleFlashes.splice(i, 1);
              continue;
            }

            let alpha;
            if (elapsed < TRIANGLE_HOLD_DURATION) {
              alpha = 255;
            } else {
              const t = (elapsed - TRIANGLE_HOLD_DURATION) / TRIANGLE_FADE_DURATION;
              alpha = p.map(t, 0, 1, 255, 0);
            }

            p.push();
            p.noFill();
            p.stroke(255, alpha);
            p.strokeWeight(10);
            p.triangle(tf.a.x, tf.a.y, tf.b.x, tf.b.y, tf.apex.x, tf.apex.y);
            p.pop();

            // Connector stem from the apex up to the label
            const labelX = tf.apex.x;
            const labelY = tf.apex.y - 70;

            p.push();
            p.stroke(255, alpha);
            p.strokeWeight(2);
            p.line(tf.apex.x, tf.apex.y, labelX, labelY + 8);
            p.pop();

            p.push();
            p.textFont(handjetFont || "IBM Plex Mono, monospace");
            p.textSize(80); // Label Text size
            const label = `+${tf.count} CELLS`.toUpperCase();
            const tw = p.textWidth(label);
            const th = 120; // approx height for textSize 32
            const iconSize = 28; // icon square size
            const iconGap = 12; // spacing between text and icon
            const totalW = tw + iconGap + iconSize;

            p.rectMode(p.CENTER);
            p.noStroke();
            p.fill(0, alpha); // black background, no border
            p.rect(labelX, labelY, totalW + 16, th + 8);

            p.textAlign(p.CENTER, p.CENTER);
            p.fill(255, alpha); // white text
            const textX = labelX - iconSize / 2 - iconGap / 2;
            p.text(label, textX, labelY);

            const iconX = textX + tw / 2 + iconGap + iconSize / 2;
            if ((p as any)._drawCellsIcon) {
              (p as any)._drawCellsIcon(tf.iconIndex || 0, iconX, labelY, iconSize, alpha);
            }
            p.pop();
          }

          // Stats HUD only needs ~2 updates/sec — no need for 12×/sec React re-renders.
          if (p.frameCount % 30 === 0 && isMounted) {
            // Stats Calculations
            const uptime = ((Date.now() - startTimeRef.current) / 1000).toFixed(
              1,
            );

            // Calculate average confidence for each model
            const getAvgConf = (items: any[], isFace: boolean = false) => {
              if (items.length === 0) return 0;
              const sum = items.reduce((acc, curr) => {
                // Try standard fields, fallback to high confidence if detected but properties missing
                const val =
                  curr.confidence ||
                  curr.score ||
                  (isFace ? 0.98 + Math.random() * 0.01 : 0);
                return acc + val;
              }, 0);
              return (sum / items.length) * 100;
            };

            // Stats Calculations
            const aliveCells = grid ? grid.aliveCount : 0;
            const currentGen = grid ? grid.generation : 0;
            const totalC = grid ? grid.totalCells : 1;

            // Population
            if (aliveCells > peakPopulation) peakPopulation = aliveCells;
            totalPopulationSum += aliveCells;
            totalGenerationsSampled++;
            const avgPop = Math.round(
              totalPopulationSum / totalGenerationsSampled,
            );
            const density = ((aliveCells / totalC) * 100).toFixed(1);

            // Interaction Rate (events per minute approx)
            const elapsedMin = (Date.now() - creationTime) / 60000;
            const rate =
              elapsedMin > 0 ? (injectionCount / elapsedMin).toFixed(1) : "0";

            setStats({
              fps: p.frameRate().toFixed(0),
              cells: aliveCells,
              faces: faces.length,
              hands: hands.length,
              bodies: poses.length,
              objects: objects.length,
              uptime: uptime,
              simulation: {
                generation: currentGen,
                density: density,
                peakPop: peakPopulation,
                avgPop: avgPop,
                rule: "B3/S23",
                seed: settingsRef.current.seed,
              },
              styles: {
                stability: "active", // TODO: Implement full stability check
                period: 0,
              },
              interaction: {
                injections: injectionCount,
                simSpeed: CONFIG.frameRate,
                lastGesture: lastGestureName,
                interactionRate: Number(rate),
              },
              confidence: {
                faces: 0,
                hands: Math.round(getAvgConf(hands)),
                bodies: Math.round(getAvgConf(poses)),
              },
            });
          }
        };

        function drawFaceMesh() {
          if (!faces.length || !triangles.length) return;
          const face = faces[0];
          if (!face?.keypoints) return;
          p.push();
          p.beginShape(p.TRIANGLES);
          for (const tri of triangles) {
            if (!tri || tri.length < 3) continue;
            const [a, b, c] = tri;
            const ptA = face.keypoints[a],
              ptB = face.keypoints[b],
              ptC = face.keypoints[c];
            if (!ptA || !ptB || !ptC) continue;
            const cx = Math.floor((ptA.x + ptB.x + ptC.x) / 3),
              cy = Math.floor((ptA.y + ptB.y + ptC.y) / 3);
            if (cx >= 0 && cx < CONFIG.video.width && cy >= 0 && cy < CONFIG.video.height) {
              p.fill(0);
              p.stroke(255);
              p.strokeWeight(0.5);
              p.vertex(ptA.x, ptA.y);
              p.vertex(ptB.x, ptB.y);
              p.vertex(ptC.x, ptC.y);
            }
          }
          p.endShape();
          p.pop();
        }

        function drawBodyPose() {
          if (!poses.length) return;
          const pose = poses[0];
          if (!pose?.keypoints) return;
          p.push();
          if (skeletonConnections.length) {
            p.stroke(255, 255, 255, 100);
            p.strokeWeight(1);
            for (const [a, b] of skeletonConnections) {
              const kpA = pose.keypoints[a],
                kpB = pose.keypoints[b];
              if (kpA?.confidence > 0.1 && kpB?.confidence > 0.1)
                p.line(kpA.x, kpA.y, kpB.x, kpB.y);
            }
          }
          p.fill(255);
          p.noStroke();
          for (const kp of pose.keypoints) {
            if (kp?.confidence > 0.1) p.circle(kp.x, kp.y, 5);
          }
          p.pop();
        }

        const HAND_CONNECTIONS = [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [0, 5],
          [5, 6],
          [6, 7],
          [7, 8],
          [0, 9],
          [9, 10],
          [10, 11],
          [11, 12],
          [0, 13],
          [13, 14],
          [14, 15],
          [15, 16],
          [0, 17],
          [17, 18],
          [18, 19],
          [19, 20],
        ];
        function drawHands() {
          if (!hands.length) return;
          p.push();

          // Determine active navigation hand: one grab at a time
          let anyGrabbing = false;

          const eligibleHands = hands.filter(
            (h) =>
              h.confidence > 0.1 &&
              h.framesLost <= 1 &&
              h.thumb_tip &&
              h.index_finger_tip,
          );

          // Joint-bend angle at the PIP joint (MCP-PIP-TIP). Straight finger ~180deg,
          // curled finger drops well below that regardless of hand rotation/tilt.
          const jointAngleDeg = (hand: any, aIdx: number, bIdx: number, cIdx: number) => {
            const a = hand.keypoints[aIdx];
            const b = hand.keypoints[bIdx];
            const c = hand.keypoints[cIdx];
            const v1x = a.x - b.x, v1y = a.y - b.y;
            const v2x = c.x - b.x, v2y = c.y - b.y;
            const mag1 = Math.hypot(v1x, v1y);
            const mag2 = Math.hypot(v2x, v2y);
            if (mag1 === 0 || mag2 === 0) return 180;
            const dot = v1x * v2x + v1y * v2y;
            const cosA = Math.min(1, Math.max(-1, dot / (mag1 * mag2)));
            return (Math.acos(cosA) * 180) / Math.PI;
          };

          // [MCP, PIP, TIP] triplets for index/middle/ring/pinky
          const FINGER_JOINTS: [number, number, number][] = [
            [5, 6, 8],
            [9, 10, 12],
            [13, 14, 16],
            [17, 18, 20],
          ];
          const CURL_ANGLE_THRESHOLD = 110; // degrees; below this = curled

          const getCurlMetrics = (hand: any) => {
            let curledCnt = 0;
            for (const [mcp, pip, tip] of FINGER_JOINTS) {
              if (jointAngleDeg(hand, mcp, pip, tip) < CURL_ANGLE_THRESHOLD) curledCnt++;
            }
            return { curledCnt, extendedCnt: 4 - curledCnt };
          };

          // Normalize pinch distance by palm size so thresholds hold at any
          // distance from the camera (wrist-to-middle-MCP as a stable ruler).
          const getPalmSize = (hand: any) => {
            const wrist = hand.keypoints[0];
            const midMcp = hand.keypoints[9];
            return Math.max(20, p.dist(wrist.x, wrist.y, midMcp.x, midMcp.y));
          };

          let isTrianglePose = false;
          if (eligibleHands.length === 2) {
            const [handA, handB] = eligibleHands;
            const aThumb = handA.thumb_tip;
            const aIndex = handA.index_finger_tip;
            const bThumb = handB.thumb_tip;
            const bIndex = handB.index_finger_tip;

            const thumbDist = p.dist(aThumb.x, aThumb.y, bThumb.x, bThumb.y);
            const indexDist = p.dist(aIndex.x, aIndex.y, bIndex.x, bIndex.y);
            const aPinchDist = p.dist(aThumb.x, aThumb.y, aIndex.x, aIndex.y);
            const bPinchDist = p.dist(bThumb.x, bThumb.y, bIndex.x, bIndex.y);

            isTrianglePose =
              thumbDist < 25 &&
              indexDist < 25 &&
              aPinchDist < 70 &&
              bPinchDist < 70;
          }

          for (const h of hands) {
            if (h.confidence <= 0.1 || h.framesLost > 1) {
              (h as any)._isGrab = false;
              continue;
            }

            const idxTip = h.index_finger_tip,
              thbTip = h.thumb_tip;

            const { curledCnt } = getCurlMetrics(h);
            const palmSize = getPalmSize(h);

            const pinchDist =
              idxTip && thbTip
                ? p.dist(idxTip.x, idxTip.y, thbTip.x, thbTip.y)
                : palmSize * 2;
            const normPinch = pinchDist / palmSize;

            // Hysteresis: separate enter/exit conditions so the state doesn't
            // flicker when a metric hovers near a single threshold.
            const prevGrab = (h as any)._isGrab === true;
            const enterGrab = curledCnt >= 3 && normPinch < 0.55 && !isTrianglePose;
            const exitGrab = curledCnt < 2 || normPinch > 0.85 || isTrianglePose;

            let nextGrab = prevGrab;
            if (!prevGrab && enterGrab) nextGrab = true;
            else if (prevGrab && exitGrab) nextGrab = false;

            const isGrab = nextGrab && h.prev_palm_x !== undefined;

            if (isGrab) anyGrabbing = true;
            (h as any)._isGrab = isGrab;
          }

          // Keep active hand only if still grabbing, else pick first grabbing hand
          if (activeNavHandId !== null) {
            const active = hands.find((h) => h.id === activeNavHandId);
            if (!active || !(active as any)._isGrab) {
              activeNavHandId = null;
            }
          }
          if (activeNavHandId === null && anyGrabbing) {
            const firstGrab = hands.find((h) => (h as any)._isGrab);
            if (firstGrab) activeNavHandId = firstGrab.id;
          }

          for (const hand of hands) {
            if (hand.confidence <= 0.1 || hand.framesLost > 1) continue;

            // Draw skeleton connections
            p.stroke(255);
            p.strokeWeight(2);
            for (const [a, b] of HAND_CONNECTIONS) {
              const kpA = hand.keypoints[a],
                kpB = hand.keypoints[b];
              if (kpA && kpB) p.line(kpA.x, kpA.y, kpB.x, kpB.y);
            }

            // Draw keypoints
            for (let i = 0; i < hand.keypoints.length; i++) {
              const kp = hand.keypoints[i];
              const isTip = i === 8 || i === 4;
              const size = isTip ? 14 : 5;

              if (isTip) {
                p.fill(0);
                p.stroke(255);
                p.strokeWeight(1);
                p.circle(kp.x, kp.y, size);
              } else {
                p.fill(255);
                p.noStroke();
                p.circle(kp.x, kp.y, size);
              }
            }

            const isNavigating = hand.id === activeNavHandId;

            if (isNavigating && (hand as any)._isGrab && hand.framesLost === 0) {
              const dx = hand.keypoints[9].x - hand.prev_palm_x;
              const dy = hand.keypoints[9].y - hand.prev_palm_y;
              const isDragging = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;

              // White outline square centered on wrist-palm midpoint (stable anchor)
              const wrist = hand.keypoints[0];
              const palmMCP = hand.keypoints[9];
              const cx = (wrist.x + palmMCP.x) / 2;
              const cy = (wrist.y + palmMCP.y) / 2;

              let minX = Infinity,
                minY = Infinity,
                maxX = -Infinity,
                maxY = -Infinity;
              for (const kp of hand.keypoints) {
                if (kp.x < minX) minX = kp.x;
                if (kp.y < minY) minY = kp.y;
                if (kp.x > maxX) maxX = kp.x;
                if (kp.y > maxY) maxY = kp.y;
              }
              const rawSize = Math.max(maxX - minX, maxY - minY) + 20;
              const prevSize = (hand as any)._smoothSize ?? rawSize;
              const sqSize = p.lerp(prevSize, rawSize, 0.25);
              (hand as any)._smoothSize = sqSize;

              p.push();
              p.rectMode(p.CENTER);
              p.noFill();
              p.stroke(255);
              p.strokeWeight(2);
              p.square(cx, cy, sqSize);
              p.pop();

              // Directional chevrons on all 4 sides of the square
              const ctx = (p as any).drawingContext as CanvasRenderingContext2D;
              if (ctx) {
                const chevronPath =
                  (p as any)._chevronPath ||
                  new Path2D("M9 17h2v-2h2v-2h2v-2h-2V9h-2V7H9v10Z");
                if (!(p as any)._chevronPath) (p as any)._chevronPath = chevronPath;

                const halfSq = sqSize / 2;
                const chevronSize = 16;
                const gap = 12;

                const directions = [
                  { x: cx + halfSq + gap, y: cy, angle: 0 },
                  { x: cx, y: cy + halfSq + gap, angle: Math.PI / 2 },
                  { x: cx - halfSq - gap, y: cy, angle: Math.PI },
                  { x: cx, y: cy - halfSq - gap, angle: -Math.PI / 2 },
                ];

                ctx.save();
                ctx.fillStyle = "#ffffff";
                for (const d of directions) {
                  ctx.save();
                  ctx.translate(d.x, d.y);
                  ctx.rotate(d.angle);
                  ctx.scale(chevronSize / 24, chevronSize / 24);
                  ctx.translate(-12, -12);
                  ctx.fill(chevronPath);
                  ctx.restore();
                }
                ctx.restore();
              }

              if (grid && isDragging) {
                // Accumulate the raw target -- this is where the hand is
                // "pulling" the grid to, independent of how fast we render.
                panTargetX += dx * scale;
                panTargetY += dy * scale;
                lastGestureName = `hand pan @ ${grid.generation}`;

                // Sample real hand velocity (px/sec) from this frame's raw
                // displacement, smoothed slightly to reduce tracking jitter.
                // This is the seed for the throw phase on release -- deliberately
                // independent of the spring's own internal velocity.
                const frameDt = Math.max(
                  (performance.now() - lastFrameMs) / 1000,
                  1 / 120,
                );
                sampleVelX = p.lerp(
                  sampleVelX,
                  (dx * scale) / frameDt,
                  VEL_SAMPLE_SMOOTH,
                );
                sampleVelY = p.lerp(
                  sampleVelY,
                  (dy * scale) / frameDt,
                  VEL_SAMPLE_SMOOTH,
                );
                isThrowing = false; // actively dragging overrides any throw
              }
            }
          }

          // The moment grab ends (hand released, lost, or no longer active),
          // hand off the sampled drag velocity to the throw phase exactly once.
          const isActivelyDragging =
            activeNavHandId !== null &&
            hands.some(
              (h) =>
                h.id === activeNavHandId &&
                (h as any)._isGrab &&
                h.framesLost === 0,
            );

          // When a new grab activates or re-grabs mid-throw:
          // Synchronize target position to current grid position so drag starts smoothly,
          // while preserving active velocity (panVelX, panVelY) so re-grabbing mid-throw
          // elastically catches the fling without a sudden hard stop.
          if (isActivelyDragging && !wasActivelyDragging && grid) {
            panTargetX = grid.panX;
            panTargetY = grid.panY;
            isThrowing = false;
          }
          wasActivelyDragging = isActivelyDragging;

          // The moment grab ends (hand released, lost, or no longer active),
          // blend physical spring velocity with sampled hand velocity for the throw phase.
          if (!isActivelyDragging && !isThrowing && grid) {
            panVelX = p.lerp(panVelX, sampleVelX, 0.5);
            panVelY = p.lerp(panVelY, sampleVelY, 0.5);
            sampleVelX = 0;
            sampleVelY = 0;
            isThrowing = true;
          }

          // Apply pan physics every frame: underdamped elastic spring-follow while dragging,
          // measured-velocity throw with friction decay after release.
          if (grid) {
            const nowMs = performance.now();
            let dtSec = (nowMs - lastFrameMs) / 1000;
            lastFrameMs = nowMs;
            dtSec = Math.min(dtSec, 1 / 30); // clamp to avoid spikes on tab-switch/lag

            if (isActivelyDragging) {
              // DRAG phase: underdamped elastic spring toward panTarget.
              // On directional change, panVel preserves momentum in the old direction
              // while the spring stretches and elastically curves back toward panTarget.
              if (sampleVelX !== 0 || sampleVelY !== 0) {
                const transferRate = Math.min(1.0, 0.20 * (dtSec * 60));
                panVelX = p.lerp(panVelX, sampleVelX, transferRate);
                panVelY = p.lerp(panVelY, sampleVelY, transferRate);
              }

              const applySpringAxis = (
                current: number,
                target: number,
                vel: number,
              ): [number, number] => {
                const displacement = current - target;
                const accel =
                  -SPRING_STIFFNESS * displacement - SPRING_DAMPING * vel;
                const nextVel = vel + accel * dtSec;
                const nextPos = current + nextVel * dtSec;
                return [nextPos, nextVel];
              };

              const [nextPanX, nextVelX] = applySpringAxis(
                grid.panX,
                panTargetX,
                panVelX,
              );
              const [nextPanY, nextVelY] = applySpringAxis(
                grid.panY,
                panTargetY,
                panVelY,
              );

              const stepDx = nextPanX - grid.panX;
              const stepDy = nextPanY - grid.panY;
              if (Math.abs(stepDx) > 0.01 || Math.abs(stepDy) > 0.01) {
                grid.setPan(stepDx, stepDy);
              }
              panVelX = nextVelX;
              panVelY = nextVelY;
            } else if (isThrowing) {
              // THROW phase: real velocity decays under exponential friction,
              // frame-rate independent via THROW_FRICTION^dtSec.
              const speed = Math.hypot(panVelX, panVelY);
              if (speed > THROW_VEL_MIN) {
                const decay = Math.pow(THROW_FRICTION, dtSec);
                const stepDx = panVelX * dtSec;
                const stepDy = panVelY * dtSec;
                grid.setPan(stepDx, stepDy);
                panVelX *= decay;
                panVelY *= decay;
                panTargetX = grid.panX;
                panTargetY = grid.panY;
                lastGestureName = `throw @ ${grid.generation}`;
              } else {
                panVelX = 0;
                panVelY = 0;
                panTargetX = grid.panX;
                panTargetY = grid.panY;
                isThrowing = false;
              }
            }
          }

          // Creating cells with BOTH hands using a triangle gesture:
          // thumbs together + index fingers together = triangle.
          // Both hands must be OPEN (not fists/grabbing) for this to count,
          // otherwise two closed fists brought close together can falsely
          // satisfy the thumb/index proximity checks below.
          //
          // CRITICAL: must be two DISTINCT physical hands, not just two
          // tracked entries. The stability tracker can briefly hold a stale
          // duplicate/ghost entry for a single hand (framesLost <= 1 during
          // a flicker), and two near-identical overlapping entries can
          // trivially satisfy the thumb/index proximity checks below,
          // producing a false one-hand "triangle". Requiring opposite
          // handedness (Left vs Right) guarantees two real separate hands.
          const eligibleForTriangle = hands.filter(
            (h) => h.confidence > 0.1 && h.framesLost <= 1,
          );

          const leftHand = eligibleForTriangle.find(
            (h) => h.handedness === "Left",
          );
          const rightHand = eligibleForTriangle.find(
            (h) => h.handedness === "Right",
          );

          const gestureHands =
            leftHand && rightHand ? [leftHand, rightHand] : [];

          if (gestureHands.length === 2) {
            const handA = gestureHands[0];
            const handB = gestureHands[1];

            const bothHandsOpen =
              !(handA as any)._isGrab && !(handB as any)._isGrab;

            if (
              bothHandsOpen &&
              handA?.thumb_tip &&
              handA?.index_finger_tip &&
              handB?.thumb_tip &&
              handB?.index_finger_tip
            ) {
              const aThumb = handA.thumb_tip;
              const aIndex = handA.index_finger_tip;
              const bThumb = handB.thumb_tip;
              const bIndex = handB.index_finger_tip;

              // Extra safeguard: require each hand's OWN thumb-index gap to be
              // open enough that it isn't itself curled into a fist shape,
              // even if the grab hysteresis hasn't flagged it yet.
              const aOwnPinch = p.dist(aThumb.x, aThumb.y, aIndex.x, aIndex.y);
              const bOwnPinch = p.dist(bThumb.x, bThumb.y, bIndex.x, bIndex.y);
              const handsNotCurled = aOwnPinch > 30 && bOwnPinch > 30;

              // Triangle detection: thumbs touching AND indexes touching (actual contact)
              const thumbDist = p.dist(aThumb.x, aThumb.y, bThumb.x, bThumb.y);
              const indexDist = p.dist(aIndex.x, aIndex.y, bIndex.x, bIndex.y);

              const thumbsTouching = thumbDist < 25;
              const indexesTouching = indexDist < 25;
              const triangleReady =
                thumbsTouching && indexesTouching && handsNotCurled;

              // Triangle geometry: thumbs form the base, midpoint of indexes is the apex
              const triCenterX =
                (aThumb.x + bThumb.x + (aIndex.x + bIndex.x) / 2) / 3;
              const triCenterY =
                (aThumb.y + bThumb.y + (aIndex.y + bIndex.y) / 2) / 3;

              const aWrist = handA.keypoints[0];
              const bWrist = handB.keypoints[0];
              const apexX = (aIndex.x + bIndex.x) / 2;
              const apexY = (aIndex.y + bIndex.y) / 2;

              // Require a much more explicit "open back up" motion before the
              // next triangle can spawn again. Using BOTH distances avoids
              // re-arming from a tiny wobble in just one fingertip pair.
              const TRIANGLE_REARM_DIST = 120;
              const triangleReleased =
                thumbDist > TRIANGLE_REARM_DIST &&
                indexDist > TRIANGLE_REARM_DIST;

              if (triangleReady) {
                // Spawn cells at the triangle center (single burst per gesture)
                if (!wasPinching) {
                  const screenX = offsetX + triCenterX * scale;
                  const screenY = offsetY + triCenterY * scale;

                  const birthed = grid.explodeAt(screenX, screenY);

                  // Freeze the triangle's vertices + apex in screen space so
                  // the flash renders correctly even after hands move/release.
                  triangleFlashes.push({
                    a: { x: offsetX + aWrist.x * scale, y: offsetY + aWrist.y * scale },
                    b: { x: offsetX + bWrist.x * scale, y: offsetY + bWrist.y * scale },
                    apex: { x: offsetX + apexX * scale, y: offsetY + apexY * scale },
                    count: birthed,
                    startTime: performance.now(),
                    iconIndex: Math.floor(
                      Math.random() * ((p as any)._cellsIconPoolSize || 1),
                    ),
                  });

                  effects.push(new PinchEffect(screenX, screenY, birthed));

                  wasPinching = true;
                  injectionCount++;
                  lastGestureName = `triangle spawn @ ${grid.generation}`;
                }
              } else if (triangleReleased) {
                wasPinching = false;
              }
            } else {
              wasPinching = false;
            }
          } else {
            wasPinching = false;
          }
          p.pop();
        }

        function drawObjects() {
          if (!objects.length) return;
          p.push();

          // Get native context for dotted lines
          const ctx = p.drawingContext as CanvasRenderingContext2D;

          for (const obj of objects) {
            // Flip x-coordinate for mirrored video as COCO-SSD might not mirror coordinates internally
            const objX = CONFIG.video.width - obj.x - obj.width;
            const objY = obj.y;

            // Draw dotted white border (1px)
            p.push();
            p.noFill();
            p.stroke(255);
            p.strokeWeight(1 / scale); // Counteract global scale for 1 screen pixel

            // Enable dotted line
            ctx.setLineDash([1, 3]); // 1px dot, 3px gap
            p.rect(objX, objY, obj.width, obj.height);
            ctx.setLineDash([]); // Reset
            p.pop();

            // Draw Label (8px fixed size)
            p.push();
            p.fill(255);
            p.noStroke();

            // Position at top-left of box
            p.translate(objX, objY);

            // Counteract global scale to draw fixed pixel size text
            p.scale(1 / scale);

            p.textSize(8);
            p.textAlign(p.LEFT, p.BOTTOM);
            const label = `${obj.label} ${Math.round((obj.confidence || 0) * 100)}%`;
            // Draw slightly above (offset by -4 pixels)
            p.text(label, 0, -4);
            p.pop();
          }
          p.pop();
        }
      };
      if (containerRef.current && !p5Ref.current)
        p5Ref.current = new P5(sketch, containerRef.current);

      const handleVisibility = () => {
        if (!p5Ref.current) return;
        if (document.hidden) {
          p5Ref.current.noLoop();
          mlControlRef.current?.pause();
        } else {
          p5Ref.current.loop();
          if (!mlPausedRef.current) {
            mlControlRef.current?.resume();
          }
        }
      };
      document.addEventListener("visibilitychange", handleVisibility);
      (window as any).__visHandler = handleVisibility;
    }

    return () => {
      isMounted = false;
      if ((window as any).__visHandler) {
        document.removeEventListener("visibilitychange", (window as any).__visHandler);
        (window as any).__visHandler = null;
      }
      if (typeof checkMl5 !== "undefined") clearInterval(checkMl5);
      // Stop native body pose polling if running
      if (nativePoseInterval !== null) {
        clearInterval(nativePoseInterval);
        nativePoseInterval = null;
      }
      if (p5Ref.current) {
        p5Ref.current.remove();
        p5Ref.current = null;
      }
      document.querySelectorAll("video").forEach((v) => {
        v.srcObject = null;
        v.remove();
      });
      initializedRef.current = false;
    };
  }, []);

  const handleMlToggle = useCallback(() => {
    const next = !mlPausedRef.current;
    mlPausedRef.current = next;
    setMlPaused(next);
    if (next) {
      // Relaxed mode: stop all ML inference AND drop render FPS to 5.
      // The GoL simulation keeps running (via its own 10 Hz internal throttle)
      // but the render loop does ~75% less GPU work.
      mlControlRef.current?.pause();
      p5Ref.current?.frameRate(5);
    } else {
      // Full mode: resume ML and restore the configured render frame rate.
      mlControlRef.current?.resume();
      p5Ref.current?.frameRate(settingsRef.current.renderFrameRate || 15);
    }
  }, []);

  // Keyboard shortcut: Cmd+Shift+1 → toggle Play/Pause
  const handleMlToggleRef = useRef(handleMlToggle);
  handleMlToggleRef.current = handleMlToggle;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === "1") {
        e.preventDefault();
        handleMlToggleRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <TerminalLoader
        steps={loadingSteps}
        isLoaded={isLoaded}
        stats={stats}
        onComplete={() => setIsLoaded(true)}
      />

      <div ref={containerRef} className="fixed inset-0" />

      {cameraError && <CameraErrorDialog error={cameraError} />}

      {/* ML Detection Pause/Resume button — bottom-left corner */}
      <button
        id="ml-detection-toggle"
        onClick={handleMlToggle}
        style={{
          position: "fixed",
          bottom: "24px",
          left: "24px",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4px",
          background: "transparent",
          border: "none",
          outline: "none",
          cursor: "pointer",
          color: "#ffffff",
          opacity: 0.5,
          transition: "opacity 0.2s ease",
          userSelect: "none",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "0.8";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "0.5";
        }}
      >
        {/* Icon */}
        {mlPaused ? (
          // Play triangle
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        ) : (
          // Pause bars
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        )}
      </button>
    </>
  );
};

function CameraErrorDialog({ error }: { error: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="bg-[#111] border border-white/20 p-6 rounded-lg font-mono text-white max-w-md w-full shadow-2xl backdrop:bg-transparent m-auto"
    >
      <h2 className="text-xl mb-4 font-bold flex items-center gap-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        Camera Error
      </h2>
      <p className="font-bold whitespace-pre-wrap">{error}</p>
      <p className="mt-4 text-sm text-white/70">
        Please allow camera access in your browser settings to use this
        application.
      </p>
    </dialog>
  );
}
