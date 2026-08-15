import type p5 from "p5";
import { decode } from "./presets/rle";
import { getPresetRLE } from "./presets/index";

export interface GameOfLifeConfig {
  cellSize: number;
  colors: {
    light: string;
    accent: readonly string[];
  };
}

const OFFSET = 16777216; // 2^24
const MULTIPLIER = 33554432; // 2^25

function hashPair(x: number, y: number) {
  return (x + OFFSET) * MULTIPLIER + (y + OFFSET);
}

function getX(key: number) {
  return Math.floor(key / MULTIPLIER) - OFFSET;
}

function getY(key: number) {
  return (key % MULTIPLIER) - OFFSET;
}

export class Grid {
  private p: p5;
  private graphics: p5.Graphics;
  readonly cellSize: number;
  private config: GameOfLifeConfig;

  generation: number = 0;
  totalCells: number = 2000000;

  panX: number = 0;
  panY: number = 0;

  alive = new Set<number>();

  // ── Sim throttle ──────────────────────────────────────────────────────────
  // update() is called on every render frame (up to 60 fps) but the actual
  // Game-of-Life computation only runs at simHz (default 10 Hz). This keeps
  // the GoL animation visible at the full render frame-rate while cutting the
  // heavy Set/Map rebuild work to ~1/6th of what it was.
  private lastSimTime: number = 0;
  private simIntervalMs: number = 100; // 10 Hz

  // ── Dirty flag ────────────────────────────────────────────────────────────
  // The offscreen graphics buffer is only cleared and repainted when the
  // simulation advanced or the pan changed. On all other frames draw() simply
  // blits the cached buffer — no canvas work at all.
  private needsRedraw: boolean = true;

  private static DIRS = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],          [1,  0],
    [-1,  1], [0,  1], [1,  1],
  ];

  constructor(p: p5, width: number, height: number, config: GameOfLifeConfig) {
    this.p = p;
    this.cellSize = config.cellSize;
    this.config = config;
    this.graphics = p.createGraphics(width, height);
  }

  /** Change the simulation speed (default 10 Hz). */
  setSimHz(hz: number) {
    this.simIntervalMs = 1000 / Math.max(1, hz);
  }

  setPan(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
    // Pan shifts which cells are in view — the buffer must be repainted.
    this.needsRedraw = true;
  }

  get aliveCount() {
    return this.alive.size;
  }

  explodeAt(screenX: number, screenY: number): number {
    const gridX = Math.floor((screenX - this.panX) / this.cellSize);
    const gridY = Math.floor((screenY - this.panY) / this.cellSize);

    let count = 0;
    const radius = 15;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (this.p.random() < 0.25) {
          if (dx * dx + dy * dy <= radius * radius * this.p.random(0.5, 1)) {
            const h = hashPair(gridX + dx, gridY + dy);
            if (!this.alive.has(h)) {
              this.alive.add(h);
              count++;
            }
          }
        }
      }
    }
    this.needsRedraw = true;
    return count;
  }

  private trackedGuns: Array<{ targetGen: number; gunHashes: Set<number> }> = [];

  clear() {
    this.alive.clear();
    this.trackedGuns = [];
    this.generation = 0;
    this.needsRedraw = true;
  }

  spawnGliderGunAt(
    screenX: number,
    screenY: number,
    rotation?: number,
    flip?: boolean,
    maxProducedCells: number = 30
  ): number {
    const gridX = Math.floor((screenX - this.panX) / this.cellSize);
    const gridY = Math.floor((screenY - this.panY) / this.cellSize);

    const rot = rotation ?? Math.floor(Math.random() * 4);
    const doFlip = flip ?? (Math.random() < 0.5);

    const gunHashes = new Set<number>();
    let count = 0;
    const setAlive = (ox: number, oy: number) => {
      let rx = ox;
      let ry = oy;

      // Apply 90-degree step rotations around center
      if (rot === 1) {
        rx = -oy;
        ry = ox;
      } else if (rot === 2) {
        rx = -ox;
        ry = -oy;
      } else if (rot === 3) {
        rx = oy;
        ry = -ox;
      }

      if (doFlip) {
        rx = -rx;
      }

      const h = hashPair(gridX + rx, gridY + ry);
      gunHashes.add(h);
      if (!this.alive.has(h)) {
        this.alive.add(h);
        count++;
      }
    };

    const points = [
      [0, 4],  [0, 5],  [1, 4],  [1, 5],
      [10, 4], [10, 5], [10, 6],
      [11, 3], [11, 7],
      [12, 2], [12, 8],
      [13, 2], [13, 8],
      [14, 5],
      [15, 3], [15, 7],
      [16, 4], [16, 5], [16, 6],
      [17, 5],
      [20, 2], [20, 3], [20, 4],
      [21, 2], [21, 3], [21, 4],
      [22, 1], [22, 5],
      [24, 0], [24, 1], [24, 5], [24, 6],
      [34, 2], [34, 3],
      [35, 2], [35, 3],
    ];
    points.forEach(([x, y]) => setAlive(x - 18, y - 4));

    // A Gosper Glider Gun emits 1 glider (5 cells) every 30 generations.
    // To cap cell production at maxProducedCells (default 30 cells = 6 gliders),
    // calculate target generation = currentGen + (6 * 30) = currentGen + 180.
    const maxGliders = Math.ceil(maxProducedCells / 5);
    const targetGen = this.generation + maxGliders * 30;
    this.trackedGuns.push({ targetGen, gunHashes });

    this.needsRedraw = true;
    return count;
  }

  spawnPattern(name: string) {
    this.clear();

    if (name === "Random") {
      this.explodeAt(this.p.width / 2, this.p.height / 2);
      return;
    }

    if (name.toLowerCase() === "gosper glider gun") {
      this.spawnGliderGunAt(this.p.width / 2, this.p.height / 2);
      return;
    }

    const rle = getPresetRLE(name);
    const cx = Math.floor((this.p.width / 2 - this.panX) / this.cellSize);
    const cy = Math.floor((this.p.height / 2 - this.panY) / this.cellSize);

    if (rle) {
      const cells = decode(rle);
      if (cells.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [x, y] of cells) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const offsetX = cx - Math.floor(width / 2) - minX;
        const offsetY = cy - Math.floor(height / 2) - minY;

        for (const [x, y] of cells) {
          this.alive.add(hashPair(x + offsetX, y + offsetY));
        }
      }
    } else if (name === "R-pentomino") {
      const setAlive = (ox: number, oy: number) => {
        this.alive.add(hashPair(cx + ox, cy + oy));
      };
      setAlive(0, -1); setAlive(1, -1);
      setAlive(-1, 0); setAlive(0, 0);
      setAlive(0, 1);
    }
    this.needsRedraw = true;
  }

  /**
   * Advance one simulation step.
   *
   * Internally throttled: no-ops and returns false if called before the next
   * scheduled sim tick. The render loop can therefore call update() every
   * frame without incurring the full Set/Map cost at 60 fps.
   */
  update(): boolean {
    const now = performance.now();
    if (now - this.lastSimTime < this.simIntervalMs) {
      return false; // too soon — skip this frame
    }
    this.lastSimTime = now;

    const neighborCounts = new Map<number, number>();

    for (const key of this.alive) {
      const x = getX(key);
      const y = getY(key);
      for (const [dx, dy] of Grid.DIRS) {
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

    this.generation++;

    if (this.trackedGuns.length > 0) {
      this.trackedGuns = this.trackedGuns.filter((gun) => {
        if (this.generation >= gun.targetGen) {
          for (const h of gun.gunHashes) {
            nextAlive.delete(h);
          }
          return false;
        }
        return true;
      });
    }

    this.alive = nextAlive;
    this.needsRedraw = true;
    return true;
  }

  /**
   * Paint the current state onto the offscreen buffer and blit it.
   *
   * The expensive clear+rect loop only runs when needsRedraw is true
   * (i.e. after a sim tick or a pan). On all other frames just the
   * cached p5.Graphics texture is composited — essentially free.
   */
  draw() {
    if (this.needsRedraw) {
      this.needsRedraw = false;
      this.graphics.clear();

      if (this.alive.size > 0) {
        const cs = this.cellSize;

        const minX = Math.floor(-this.panX / cs);
        const minY = Math.floor(-this.panY / cs);
        const maxX = minX + Math.ceil(this.p.width / cs) + 1;
        const maxY = minY + Math.ceil(this.p.height / cs) + 1;

        this.graphics.noStroke();
        this.graphics.fill(this.config.colors.light);

        for (const key of this.alive) {
          const x = getX(key);
          const y = getY(key);

          if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
            const screenX = x * cs + this.panX;
            const screenY = y * cs + this.panY;
            this.graphics.rect(screenX, screenY, cs, cs);
          }
        }
      }
    }

    // Always blit the cached buffer — even if nothing changed this frame.
    this.p.image(this.graphics, 0, 0);
  }
}
