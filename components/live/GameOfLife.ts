import type p5 from "p5";

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
  
  private static DIRS = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],          [1,  0],
    [-1,  1], [0,  1], [1,  1]
  ];

  constructor(p: p5, width: number, height: number, config: GameOfLifeConfig) {
    this.p = p;
    this.cellSize = config.cellSize;
    this.config = config;
    this.graphics = p.createGraphics(width, height);
  }

  setPan(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
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
          if (dx*dx + dy*dy <= radius*radius * this.p.random(0.5, 1)) {
            const h = hashPair(gridX + dx, gridY + dy);
            if (!this.alive.has(h)) {
              this.alive.add(h);
              count++;
            }
          }
        }
      }
    }
    return count;
  }

  clear() {
    this.alive.clear();
    this.generation = 0;
  }

  spawnPattern(name: string) {
    const cx = Math.floor((this.p.width / 2 - this.panX) / this.cellSize);
    const cy = Math.floor((this.p.height / 2 - this.panY) / this.cellSize);

    if (name === "Random") {
     this.explodeAt(this.p.width / 2, this.p.height / 2);
     return;
    }

    const setAlive = (ox: number, oy: number) => {
      this.alive.add(hashPair(cx + ox, cy + oy));
    };

    if (name === "R-pentomino") {
      setAlive(0, -1); setAlive(1, -1);
      setAlive(-1, 0); setAlive(0, 0);
      setAlive(0, 1);
    } else if (name === "Gosper glider gun") {
       const points = [
        [0, 4], [0, 5], [1, 4], [1, 5],
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
        [35, 2], [35, 3]
       ];
       points.forEach(([x, y]) => setAlive(x - 15, y - 5));
    }
  }

  update() {
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

    this.alive = nextAlive;
    this.generation++;
  }

  draw() {
    this.graphics.clear();
    const cs = this.cellSize;
    
    const minX = Math.floor(-this.panX / cs);
    const minY = Math.floor(-this.panY / cs);
    const maxX = minX + Math.ceil(this.p.width / cs) + 1;
    const maxY = minY + Math.ceil(this.p.height / cs) + 1;
    
    this.graphics.noStroke();
    
    for (const key of this.alive) {
      const x = getX(key);
      const y = getY(key);
      
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        this.graphics.fill(this.config.colors.light as any);
        
        const screenX = x * cs + this.panX;
        const screenY = y * cs + this.panY;
        this.graphics.rect(screenX, screenY, cs, cs);
      }
    }
    
    this.p.image(this.graphics, 0, 0);
  }
}
