"use client";

import { useEffect, useRef } from "react";
import type p5 from "p5";

const CONFIG = {
  cellSize: 4,
  frameRate: 15,
  colors: {
    light: "rgba(241, 246, 241, 0.3)", // Faint light green/white
    accent: "rgba(32, 163, 158, 0.4)", // Faint teal
    bg: "rgba(0, 0, 0, 0)", // Transparent background to layer over image
  },
  portalRate: 60, // frames between portal bursts
} as const;

// Simplified Grid implementation directly in the component for portability
const OFFSET = 16777216;
const MULTIPLIER = 33554432;

function hashPair(x: number, y: number) {
  return (x + OFFSET) * MULTIPLIER + (y + OFFSET);
}

function getX(key: number) {
  return Math.floor(key / MULTIPLIER) - OFFSET;
}

function getY(key: number) {
  return (key % MULTIPLIER) - OFFSET;
}

class IndexGrid {
  private p: p5;
  private graphics: p5.Graphics;
  readonly cellSize: number;
  alive = new Set<number>();
  generation: number = 0;

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

  constructor(p: p5, width: number, height: number, cellSize: number) {
    this.p = p;
    this.cellSize = cellSize;
    this.graphics = p.createGraphics(width, height);
  }

  update() {
    const neighborCounts = new Map<number, number>();
    for (const key of this.alive) {
      const x = getX(key);
      const y = getY(key);
      for (const [dx, dy] of IndexGrid.DIRS) {
        const nKey = hashPair(x + dx, y + dy);
        neighborCounts.set(nKey, (neighborCounts.get(nKey) || 0) + 1);
      }
    }

    const nextAlive = new Set<number>();
    for (const [key, count] of neighborCounts) {
      if (count === 3 || (count === 2 && this.alive.has(key))) {
        nextAlive.add(key);
      }
    }

    this.alive = nextAlive;
    this.generation++;
  }

  spawnPortal(x: number, y: number, type: "random" | "pentomino" = "random") {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);

    if (type === "random") {
      const radius = 5;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (this.p.random() < 0.3 && dx * dx + dy * dy <= radius * radius) {
            this.alive.add(hashPair(gx + dx, gy + dy));
          }
        }
      }
    } else {
      // R-pentomino
      const pts = [
        [0, -1],
        [1, -1],
        [-1, 0],
        [0, 0],
        [0, 1],
      ];
      pts.forEach(([ox, oy]) => this.alive.add(hashPair(gx + ox, gy + oy)));
    }
  }

  draw() {
    this.graphics.clear();
    const cs = this.cellSize;
    this.graphics.noStroke();
    this.graphics.fill(CONFIG.colors.light);

    for (const key of this.alive) {
      const x = getX(key);
      const y = getY(key);
      const sx = x * cs;
      const sy = y * cs;

      // Basic occlusion for performance
      if (sx >= 0 && sx <= this.p.width && sy >= 0 && sy <= this.p.height) {
        this.graphics.rect(sx, sy, cs, cs);
      }
    }
    this.p.image(this.graphics, 0, 0);
  }

  resize(w: number, h: number) {
    this.graphics = this.p.createGraphics(w, h);
  }
}

export const GoLIndex = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Ref = useRef<p5 | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let grid: IndexGrid;

    const sketch = (p: p5) => {
      p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight);
        p.frameRate(CONFIG.frameRate);
        grid = new IndexGrid(p, p.width, p.height, CONFIG.cellSize);

        // Initial bursts
        grid.spawnPortal(p.width * 0.25, p.height * 0.25, "pentomino");
        grid.spawnPortal(p.width * 0.75, p.height * 0.75, "pentomino");
        grid.spawnPortal(p.width * 0.5, p.height * 0.5, "random");
      };

      p.draw = () => {
        p.clear(); // Transparent background

        if (grid) {
          // Portal Logic (Non-stop cell production)
          if (p.frameCount % CONFIG.portalRate === 0) {
            // Spawn across the screen
            grid.spawnPortal(
              p.random(p.width),
              p.random(p.height),
              p.random() > 0.5 ? "pentomino" : "random",
            );
          }

          // Random sparks at "collider" points (fixed locations)
          const colliders = [
            { x: 0.1, y: 0.1 },
            { x: 0.9, y: 0.1 },
            { x: 0.1, y: 0.9 },
            { x: 0.9, y: 0.9 },
            { x: 0.5, y: 0.5 },
          ];

          colliders.forEach((c) => {
            if (p.random() < 0.05) {
              grid.spawnPortal(p.width * c.x, p.height * c.y, "random");
            }
          });

          grid.update();
          grid.draw();
        }
      };

      p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight);
        grid?.resize(p.width, p.height);
      };
    };

    const initP5 = async () => {
      const P5 = (await import("p5")).default;
      if (containerRef.current && !p5Ref.current) {
        p5Ref.current = new P5(sketch, containerRef.current);
      }
    };

    initP5();

    return () => {
      if (p5Ref.current) {
        p5Ref.current.remove();
        p5Ref.current = null;
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0 pointer-events-none z-5" />
  );
};
