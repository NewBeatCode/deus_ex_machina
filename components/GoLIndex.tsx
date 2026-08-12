"use client";

import { useEffect, useRef } from "react";
import type p5 from "p5";

const CONFIG = {
  cellSize: 2,
  frameRate: 12,
  text: ["DEUS   ex", "MACHINA"] as const,
  fontFamily: "'Handjet', sans-serif",
  fontWeight: "900",
  colors: {
    alive: "#ffffff",
    glow: "#ffffff",
    border: "#cccccc",
  },
  portalRate: 45,
  initialDensity: 0.55,
} as const;

const OFFSET = 16777216;
const MULTIPLIER = 33554432;
const hashPair = (x: number, y: number) =>
  (x + OFFSET) * MULTIPLIER + (y + OFFSET);
const getX = (key: number) => Math.floor(key / MULTIPLIER) - OFFSET;
const getY = (key: number) => (key % MULTIPLIER) - OFFSET;

interface MaskData {
  mask: boolean[][];
  border: Set<number>;
  cols: number;
  rows: number;
}

function buildMaskData(
  text: string | readonly string[],
  canvasW: number,
  canvasH: number,
  cellSize: number,
  fontFamily: string,
  fontWeight: string,
): MaskData {
  const cols = Math.ceil(canvasW / cellSize);
  const rows = Math.ceil(canvasH / cellSize);

  const lines = typeof text === "string" ? text.split("\n") : text;
  const offscreen = document.createElement("canvas");
  offscreen.width = canvasW;
  offscreen.height = canvasH;
  const ctx = offscreen.getContext("2d")!;
  const fontSize = Math.floor((canvasH * 0.55) / lines.length);
  const lineHeight = fontSize * 1.05;
  const startY = canvasH / 2 - ((lines.length - 1) * lineHeight) / 2;

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  lines.forEach((line, index) => {
    ctx.fillText(line, canvasW / 2, startY + index * lineHeight);
  });

  const { data } = ctx.getImageData(0, 0, canvasW, canvasH);

  const mask: boolean[][] = Array.from({ length: cols }, () =>
    new Array(rows).fill(false),
  );
  for (let gx = 0; gx < cols; gx++) {
    for (let gy = 0; gy < rows; gy++) {
      const px = Math.min(
        Math.floor(gx * cellSize + cellSize / 2),
        canvasW - 1,
      );
      const py = Math.min(
        Math.floor(gy * cellSize + cellSize / 2),
        canvasH - 1,
      );
      const idx = (py * canvasW + px) * 4;
      mask[gx][gy] = data[idx + 3] > 64;
    }
  }

  const DIRS = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  const border = new Set<number>();
  for (let gx = 0; gx < cols; gx++) {
    for (let gy = 0; gy < rows; gy++) {
      if (!mask[gx][gy]) continue;
      for (const [dx, dy] of DIRS) {
        const nx = gx + dx;
        const ny = gy + dy;
        const neighborInMask =
          nx >= 0 && ny >= 0 && nx < cols && ny < rows && mask[nx][ny];
        if (!neighborInMask) {
          border.add(hashPair(gx, gy));
          break;
        }
      }
    }
  }

  return { mask, border, cols, rows };
}

class MaskedGoL {
  private p: p5;
  private graphics: p5.Graphics;
  readonly cellSize: number;
  alive = new Set<number>();
  border = new Set<number>();
  private mask!: boolean[][];
  private cols!: number;
  private rows!: number;

  private static DIRS = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  constructor(
    p: p5,
    width: number,
    height: number,
    cellSize: number,
    maskData: MaskData,
  ) {
    this.p = p;
    this.cellSize = cellSize;
    this.graphics = p.createGraphics(width, height);
    this.applyMaskData(maskData);
  }

  private applyMaskData(maskData: MaskData) {
    this.mask = maskData.mask;
    this.border = maskData.border;
    this.cols = maskData.cols;
    this.rows = maskData.rows;
  }

  private inMask(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return false;
    return this.mask[gx][gy];
  }

  private isBorder(key: number): boolean {
    return this.border.has(key);
  }

  seedFromMask(density: number) {
    for (let gx = 0; gx < this.cols; gx++) {
      for (let gy = 0; gy < this.rows; gy++) {
        const key = hashPair(gx, gy);
        if (
          this.inMask(gx, gy) &&
          !this.isBorder(key) &&
          this.p.random() < density
        ) {
          this.alive.add(key);
        }
      }
    }
  }

  update() {
    const neighborCounts = new Map<number, number>();

    for (const key of this.alive) {
      const x = getX(key);
      const y = getY(key);
      for (const [dx, dy] of MaskedGoL.DIRS) {
        const nKey = hashPair(x + dx, y + dy);
        neighborCounts.set(nKey, (neighborCounts.get(nKey) || 0) + 1);
      }
    }

    const nextAlive = new Set<number>();
    for (const [key, count] of neighborCounts) {
      const gx = getX(key);
      const gy = getY(key);
      if (!this.inMask(gx, gy)) continue;
      if (this.isBorder(key)) continue;
      if (count === 3 || (count === 2 && this.alive.has(key))) {
        nextAlive.add(key);
      }
    }

    this.alive = nextAlive;
  }

  spawnBurst(cx: number, cy: number, radius = 6) {
    const gcx = Math.floor(cx / this.cellSize);
    const gcy = Math.floor(cy / this.cellSize);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const gx = gcx + dx;
          const gy = gcy + dy;
          const key = hashPair(gx, gy);
          if (
            this.inMask(gx, gy) &&
            !this.isBorder(key) &&
            this.p.random() < 0.5
          ) {
            this.alive.add(key);
          }
        }
      }
    }
  }

  draw() {
    this.graphics.clear();
    const cs = this.cellSize;
    this.graphics.noStroke();
    const cx = this.p.width / 2;

    for (const key of this.alive) {
      const gx = getX(key);
      const gy = getY(key);
      const sx = gx * cs;
      const sy = gy * cs;
      const dist = Math.abs(sx - cx) / (this.p.width / 2);
      this.graphics.fill(dist < 0.4 ? CONFIG.colors.glow : CONFIG.colors.alive);
      this.graphics.rect(sx, sy, cs - 1, cs - 1);
    }

    this.graphics.fill(CONFIG.colors.border);
    for (const key of this.border) {
      const gx = getX(key);
      const gy = getY(key);
      this.graphics.rect(gx * cs, gy * cs, cs - 1, cs - 1);
    }

    this.p.image(this.graphics, 0, 0);
  }

  resize(w: number, h: number, data: MaskData) {
    this.applyMaskData(data);
    this.graphics = this.p.createGraphics(w, h);
    this.alive.clear();
    this.seedFromMask(CONFIG.initialDensity);
  }
}

async function loadSilkscreenFont() {
  if (typeof document !== "undefined" && "fonts" in document) {
    await document.fonts.load(`1rem "Silkscreen"`);
    await document.fonts.ready;
  }
}

export const GoLIndex = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Ref = useRef<p5 | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let gol: MaskedGoL;

    const sketch = (p: p5) => {
      p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight);
        p.frameRate(CONFIG.frameRate);

        const data = buildMaskData(
          CONFIG.text,
          p.width,
          p.height,
          CONFIG.cellSize,
          CONFIG.fontFamily,
          CONFIG.fontWeight,
        );
        gol = new MaskedGoL(p, p.width, p.height, CONFIG.cellSize, data);
        gol.seedFromMask(CONFIG.initialDensity);
      };

      p.draw = () => {
        p.clear();
        if (!gol) return;

        if (p.frameCount % CONFIG.portalRate === 0) {
          gol.spawnBurst(p.random(p.width), p.random(p.height), 8);
        }
        if (gol.alive.size < 50) {
          gol.seedFromMask(CONFIG.initialDensity * 0.6);
        }

        gol.update();
        gol.draw();
      };

      p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight);
        const data = buildMaskData(
          CONFIG.text,
          p.width,
          p.height,
          CONFIG.cellSize,
          CONFIG.fontFamily,
          CONFIG.fontWeight,
        );
        gol?.resize(p.width, p.height, data);
      };
    };

    const initP5 = async () => {
      await loadSilkscreenFont();
      const P5 = (await import("p5")).default;
      if (containerRef.current && !p5Ref.current) {
        p5Ref.current = new P5(sketch, containerRef.current);
      }
    };

    initP5();

    return () => {
      p5Ref.current?.remove();
      p5Ref.current = null;
    };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0 pointer-events-none z-5" />
  );
};
