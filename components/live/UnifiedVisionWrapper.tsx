"use client";

import { useEffect, useRef, useState } from "react";
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
  cellSize: 2, // pixels per cell
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
}

export const UnifiedVisionWrapper = ({
  settings = { gridSize: 2, seed: "Random", objectDetection: false },
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

  useEffect(() => {
    if (JSON.stringify(settingsRef.current) !== JSON.stringify(settings)) {
      settingsRef.current = settings;
      needsResetRef.current = true;
    }
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
      } catch (err: any) {
        if (isMounted) {
          setCameraError(
            "[browser] NotAllowedError: Permission denied by system",
          );
        }
      }

      if (!isMounted) return;
      checkMl5 = setInterval(() => {
        // @ts-ignore
        if (window.ml5 && isMounted) {
          clearInterval(checkMl5);
          // Force WebGL backend to avoid WebGPU sync warnings
          // @ts-ignore
          if (window.tf) {
            // @ts-ignore
            window.tf.setBackend("webgl").then(() => initSketch());
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
        let pg: any;
        let grid: Grid;

        // ML models
        let faceMesh: any;
        let bodyPose: any;
        let handPose: any;
        let objectDetector: any;

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
        let lastGestureTime = 0;
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
              if (hand.confidence < 0.1) continue;
              const wrist = hand.keypoints[0];
              let bestMatch: any = null;
              let minDist = 150;
              for (const sh of this.smoothed) {
                if (usedSmoothed.has(sh)) continue;
                const shWrist = sh.keypoints[0];
                const d = p.dist(wrist.x, wrist.y, shWrist.x, shWrist.y);
                if (d < minDist) {
                  minDist = d;
                  bestMatch = sh;
                }
              }
              if (bestMatch) {
                usedSmoothed.add(bestMatch);
                bestMatch.framesLost = 0;
                bestMatch.confidence = hand.confidence;
                bestMatch.handedness = hand.handedness;

                // Store previous palm position for drag/pan
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
        let effects: any[] = [];

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
            // Draw circle
            p.noFill();
            p.stroke(255, this.alpha);
            p.strokeWeight(1);
            p.circle(this.x, this.y, p.map(this.alpha, 255, 0, 0, 100));

            // Draw text with background
            p.textSize(10);
            const label = `+${this.count} cells`;
            const tw = p.textWidth(label);
            const th = 14; // Approx height for textSize 10

            p.rectMode(p.CENTER);
            p.stroke(0, this.alpha); // Border color (black or adjust if needed, user asked for 1px border)
            p.fill(255, this.alpha); // White background
            p.rect(this.x, this.y + this.yOff - 25, tw + 8, th + 4);

            p.textAlign(p.CENTER, p.CENTER);
            p.noStroke();
            p.fill(0, this.alpha); // Black text
            p.text(label, this.x, this.y + this.yOff - 25);
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
          p.createCanvas(p.windowWidth, p.windowHeight);
          p.pixelDensity(1);
          p.frameRate(CONFIG.frameRate);
          // Set font for canvas drawing
          p.textFont("Roboto Mono, monospace");
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

          pg = p.createGraphics(CONFIG.video.width, CONFIG.video.height);
          pg.pixelDensity(1);
          (pg.elt as HTMLCanvasElement).getContext("2d", {
            willReadFrequently: true,
          });

          updateStepStatus("gameoflife", "loading");
          setTimeout(() => {
            grid = new Grid(p, p.windowWidth, p.windowHeight, CONFIG);
            grid.explodeAt(p.windowWidth / 2, p.windowHeight / 2);
            updateStepStatus("gameoflife", "completed");
          }, 100);

          initModels();
        };

        let isDragging = false;

        p.mousePressed = () => {
          isDragging = false;
        };

        p.mouseDragged = () => {
          if (grid) {
            isDragging = true;
            grid.setPan(p.mouseX - p.pmouseX, p.mouseY - p.pmouseY);
          }
        };

        p.mouseReleased = () => {
          // cell creation is gesture-only (both hands triangle)
        };

        p.windowResized = () => {
          p.resizeCanvas(p.windowWidth, p.windowHeight);
          updateScale();
          grid = new Grid(p, p.windowWidth, p.windowHeight, CONFIG);
          grid.explodeAt(p.windowWidth / 2, p.windowHeight / 2);
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
          // @ts-ignore
          const ml5 = window.ml5;

          try {
            updateStepStatus("ml5", "loading");
            await new Promise((resolve) => setTimeout(resolve, 100));
            updateStepStatus("ml5", "completed");

            // Load models in parallel for faster initialization
            updateStepStatus("movenet", "loading");
            updateStepStatus("handpose", "loading");
            updateStepStatus("facemesh", "loading");

            const [bp, hp, fm] = await Promise.all([
              ml5.bodyPose("MoveNet", { flipped: true }),
              ml5.handPose({
                flipped: true,
                maxHands: 2,
                runtime: "mediapipe",
                modelType: "full",
              }),
              ml5.faceMesh(videoElt, { maxFaces: 1, flipped: true }),
            ]);

            bodyPose = bp;
            if (bodyPose?.getSkeleton)
              skeletonConnections = bodyPose.getSkeleton();
            startDetection(bodyPose, (r: any[]) => (poses = r));
            updateStepStatus("movenet", "completed");

            handPose = hp;
            startDetection(handPose, (r: any[]) => {
              rawHands = r;
              console.log("[handpose-callback] rawHands.length:", r?.length ?? "undefined");
            });
            updateStepStatus("handpose", "completed");

            faceMesh = fm;
            triangles = extractTriangles(faceMesh);
            startDetection(faceMesh, (r: any[]) => (faces = r));
            updateStepStatus("facemesh", "completed");
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
          p.background(CONFIG.colors.dark);
          handTracker.update(rawHands);
          hands = handTracker.smoothed;

          // Check for settings updates
          if (needsResetRef.current) {
            const s = settingsRef.current;
            // Recreate grid if size changed or just reset if seed changed
            // For simplicity, we just recreate to handle size changes easily
            if (grid.cellSize !== s.gridSize) {
              grid = new Grid(p, p.windowWidth, p.windowHeight, {
                ...CONFIG,
                cellSize: s.gridSize,
              });
            }
            if (s.seed !== "Random" && s.seed !== stats.simulation.seed) {
              grid.spawnPattern(s.seed);
            } else if (s.seed === "Random" && needsResetRef.current) {
              // If explicitly requested reset on random, explode again
              grid.explodeAt(p.width / 2, p.height / 2);
            }

            // Dynamic COCO-SSD Loading
            if (
              s.objectDetection &&
              !objectDetector &&
              !objectDetectorLoading
            ) {
              // Initialize if enabled but not loaded
              // @ts-ignore
              const ml5 = window.ml5;
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

          if (video && video.elt && video.elt.readyState >= 2) {
            pg.image(video, 0, 0);
            pg.loadPixels();
          }

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

          if (p.frameCount % 5 === 0 && isMounted) {
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
          if (!faces.length || !triangles.length || !pg.pixels?.length) return;
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
            if (cx >= 0 && cx < pg.width && cy >= 0 && cy < pg.height) {
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
          [0, 1], [1, 2], [2, 3], [3, 4],
          [0, 5], [5, 6], [6, 7], [7, 8],
          [0, 9], [9, 10], [10, 11], [11, 12],
          [0, 13], [13, 14], [14, 15], [15, 16],
          [0, 17], [17, 18], [18, 19], [19, 20],
        ];
        function drawHands() {
          if (!hands.length) return;
          p.push();

          // Determine the active navigating hand (persist ID if still present)
          if (
            !hands.find(
              (h) => h.id === activeNavHandId && h.handedness === "Right",
            )
          ) {
            activeNavHandId = null;
          }
          if (activeNavHandId === null) {
            const suitableHand = hands.find((h) => h.handedness === "Right");
            if (suitableHand) {
              activeNavHandId = suitableHand.id;
            }
          }

          for (const hand of hands) {
            if (hand.confidence <= 0.1) continue;

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

            const indexTip = hand.index_finger_tip,
              thumbTip = hand.thumb_tip;
            let d = 100;

            // Five-finger hand gesture for panning
            let openFingers = 0;
            const pairs = [
              [8, 6],
              [12, 10],
              [16, 14],
              [20, 18],
            ];
            const wrist = hand.keypoints[0];
            for (const [tip, pip] of pairs) {
              const dTip = p.dist(
                wrist.x,
                wrist.y,
                hand.keypoints[tip].x,
                hand.keypoints[tip].y,
              );
              const dPip = p.dist(
                wrist.x,
                wrist.y,
                hand.keypoints[pip].x,
                hand.keypoints[pip].y,
              );
              if (dTip > dPip) openFingers++;
            }

            if (indexTip && thumbTip) {
              d = p.dist(indexTip.x, indexTip.y, thumbTip.x, thumbTip.y);
            }

            const isRightHand = hand.handedness === "Right";
            const isNavigatingHand = isRightHand && hand.id === activeNavHandId;

            // If an open hand (at least 3 fingers extended) and navigating with RIGHT hand
            if (
              isNavigatingHand &&
              openFingers >= 3 &&
              d > 40 &&
              hand.prev_palm_x !== undefined
            ) {
              const dx = hand.keypoints[9].x - hand.prev_palm_x;
              const dy = hand.keypoints[9].y - hand.prev_palm_y;

              // Draw indicator circle around the active navigating hand
              p.push();
              p.noFill();
              p.stroke(CONFIG.colors.accent[3]); // Teal highlight
              p.strokeWeight(3);
              // Circle around the center of the palm
              p.circle(hand.keypoints[9].x, hand.keypoints[9].y, 100);
              p.pop();

              if (grid && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
                grid.setPan(dx * scale, dy * scale);
                lastGestureName = `hand pan @ ${grid.generation}`;
              }
            }

          }

          // Creating cells with BOTH hands using a triangle gesture:
          // thumbs together + index fingers together = triangle
          const gestureHands = hands.filter((h) => h.confidence > 0.1).slice(0, 2);

          if (gestureHands.length === 2) {
            const handA = gestureHands[0];
            const handB = gestureHands[1];

            if (
              handA?.thumb_tip &&
              handA?.index_finger_tip &&
              handB?.thumb_tip &&
              handB?.index_finger_tip
            ) {
              const aThumb = handA.thumb_tip;
              const aIndex = handA.index_finger_tip;
              const bThumb = handB.thumb_tip;
              const bIndex = handB.index_finger_tip;

              // Triangle detection: thumbs touching AND indexes touching (actual contact)
              const thumbDist = p.dist(aThumb.x, aThumb.y, bThumb.x, bThumb.y);
              const indexDist = p.dist(aIndex.x, aIndex.y, bIndex.x, bIndex.y);

              const thumbsTouching = thumbDist < 25;
              const indexesTouching = indexDist < 25;
              const triangleReady = thumbsTouching && indexesTouching;

              // Triangle geometry: thumbs form the base, midpoint of indexes is the apex
              const triCenterX = (aThumb.x + bThumb.x + (aIndex.x + bIndex.x) / 2) / 3;
              const triCenterY = (aThumb.y + bThumb.y + (aIndex.y + bIndex.y) / 2) / 3;

              if (triangleReady) {
                p.push();
                p.noStroke();
                p.fill(80, 220, 120, 220);
                p.circle(triCenterX, triCenterY, 14);
                p.pop();

                // Spawn cells at the triangle center (single burst per gesture)
                if (!wasPinching) {
                  const screenX = offsetX + triCenterX * scale;
                  const screenY = offsetY + triCenterY * scale;

                  const birthed = grid.explodeAt(screenX, screenY);
                  effects.push(new PinchEffect(screenX, screenY, birthed));

                  wasPinching = true;
                  injectionCount++;
                  lastGestureName = `triangle spawn @ ${grid.generation}`;
                }
              } else if (thumbDist > 80 || indexDist > 80) {
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
    }

    return () => {
      isMounted = false;
      if (typeof checkMl5 !== "undefined") clearInterval(checkMl5);
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
