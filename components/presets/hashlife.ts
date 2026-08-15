/* eslint-disable @typescript-eslint/no-explicit-any */
import { encode, decode } from './rle'

export class TreeNode {
  static pool: Map<any, any> = new Map()
  nw: any
  ne: any
  sw: any
  se: any
  pop: number
  level: number
  result: any
  resultStep: number
  id: number
  constructor(nw: any, ne: any, sw: any, se: any) {
    this.nw = nw
    this.ne = ne
    this.sw = sw
    this.se = se
    if (typeof nw !== 'object') {
      this.pop = (nw as number) + (ne as number) + (sw as number) + (se as number)
      this.level = 1
    } else {
      this.pop = nw.pop + ne.pop + sw.pop + se.pop
      this.level = nw.level + 1
    }
    this.result = null
    this.resultStep = -1
    this.id = Math.random()
  }

  static hash(nw: any, ne: any, sw: any, se: any): number {
    return (
      0.3870661942527105 * (nw.id || nw) +
      0.7760699850060107 * (ne.id || ne) +
      0.2888132005064035 * (sw.id || sw) +
      0.5184920551312162 * (se.id || se)
    )
  }

  static create(nw: any, ne: any, sw: any, se: any): TreeNode {
    const hsh = this.hash(nw, ne, sw, se)
    if (this.pool.has(hsh)) return this.pool.get(hsh)
    const obj = new this(nw, ne, sw, se)
    this.pool.set(hsh, obj)
    return obj
  }

  static emptyTree(level: number): TreeNode {
    if (level === 1) return this.create(false, false, false, false)
    const n = this.emptyTree(level - 1)
    return this.create(n, n, n, n)
  }

  expand(): TreeNode {
    const e = (this.constructor as any).emptyTree(this.level - 1)
    return (this.constructor as any).create(
      (this.constructor as any).create(e, e, e, this.nw),
      (this.constructor as any).create(e, e, this.ne, e),
      (this.constructor as any).create(e, this.sw, e, e),
      (this.constructor as any).create(this.se, e, e, e)
    )
  }

  getBit(x: number, y: number): any {
    if (this.level === 1)
      return x < 0 ? (y < 0 ? this.nw : this.sw) : y < 0 ? this.ne : this.se
    const val = Math.pow(2, this.level - 2)
    if (x < 0) {
      if (y < 0) return this.nw.getBit(x + val, y + val)
      else return this.sw.getBit(x + val, y - val)
    } else {
      if (y < 0) return this.ne.getBit(x - val, y + val)
      else return this.se.getBit(x - val, y - val)
    }
  }

  setBit(x: number, y: number, c: any): TreeNode {
    if (this.level === 1) {
      if (x < 0) {
        if (y < 0) return (this.constructor as any).create(c, this.ne, this.sw, this.se)
        else return (this.constructor as any).create(this.nw, this.ne, c, this.se)
      } else {
        if (y < 0) return (this.constructor as any).create(this.nw, c, this.sw, this.se)
        else return (this.constructor as any).create(this.nw, this.ne, this.sw, c)
      }
    }
    const val = Math.pow(2, this.level - 2)
    if (x < 0) {
      if (y < 0)
        return (this.constructor as any).create(
          this.nw.setBit(x + val, y + val, c),
          this.ne,
          this.sw,
          this.se
        )
      else
        return (this.constructor as any).create(
          this.nw,
          this.ne,
          this.sw.setBit(x + val, y - val, c),
          this.se
        )
    } else {
      if (y < 0)
        return (this.constructor as any).create(
          this.nw,
          this.ne.setBit(x - val, y + val, c),
          this.sw,
          this.se
        )
      else
        return (this.constructor as any).create(
          this.nw,
          this.ne,
          this.sw,
          this.se.setBit(x - val, y - val, c)
        )
    }
  }

  centeredSubnode(): TreeNode {
    return (this.constructor as any).create(
      this.nw.se,
      this.ne.sw,
      this.sw.ne,
      this.se.nw
    )
  }

  vertical(south: any): TreeNode {
    return (this.constructor as any).create(this.sw, this.se, south.nw, south.ne)
  }

  centeredVertical(south: any): TreeNode {
    return (this.constructor as any).create(
      this.sw.se,
      this.se.sw,
      south.nw.ne,
      south.ne.nw
    )
  }

  horizontal(east: any): TreeNode {
    return (this.constructor as any).create(this.ne, east.nw, this.se, east.sw)
  }

  centeredHorizontal(east: any): TreeNode {
    return (this.constructor as any).create(
      this.ne.se,
      east.nw.sw,
      this.se.ne,
      east.sw.nw
    )
  }

  centeredSubSubnode(): TreeNode {
    return (this.constructor as any).create(
      this.nw.se.se,
      this.ne.sw.sw,
      this.sw.ne.ne,
      this.se.nw.nw
    )
  }

  applyRule(neighbors: number, current: any): any {
    return neighbors === 3 || (neighbors === 2 && current)
  }

  slowSimulation(): TreeNode {
    if (this.level !== 2) throw new Error('Base case can only be called for level 2 nodes')
    const x00 = this.nw.nw
    const x01 = this.nw.ne + this.ne.nw
    const x02 = this.ne.ne
    const x10 = this.nw.sw + this.sw.nw
    const x11 = this.centeredSubnode().pop
    const x12 = this.ne.se + this.se.ne
    const x20 = this.sw.sw
    const x21 = this.sw.se + this.se.sw
    const x22 = this.se.se
    return (this.constructor as any).create(
      this.applyRule(x00 + x01 + x10 + x11 - this.nw.se, this.nw.se),
      this.applyRule(x01 + x02 + x11 + x12 - this.ne.sw, this.ne.sw),
      this.applyRule(x10 + x11 + x20 + x21 - this.sw.ne, this.sw.ne),
      this.applyRule(x11 + x12 + x21 + x22 - this.se.nw, this.se.nw)
    )
  }

  step(k: number): TreeNode {
    if (this.resultStep === k) return this.result
    if (this.level < 2) throw new Error('Step can only be computed for nodes of level >= 2')
    if (k > this.level - 2) throw new Error('Step size greater than level - 2')
    if (this.level === 2) {
      this.result = this.slowSimulation()
    } else if (this.level === k + 2) {
      const n00 = this.nw.step(k - 1)
      const n01 = this.nw.horizontal(this.ne).step(k - 1)
      const n02 = this.ne.step(k - 1)
      const n10 = this.nw.vertical(this.sw).step(k - 1)
      const n11 = this.centeredSubnode().step(k - 1)
      const n12 = this.ne.vertical(this.se).step(k - 1)
      const n20 = this.sw.step(k - 1)
      const n21 = this.sw.horizontal(this.se).step(k - 1)
      const n22 = this.se.step(k - 1)
      this.result = (this.constructor as any).create(
        (this.constructor as any).create(n00, n01, n10, n11).step(k - 1),
        (this.constructor as any).create(n01, n02, n11, n12).step(k - 1),
        (this.constructor as any).create(n10, n11, n20, n21).step(k - 1),
        (this.constructor as any).create(n11, n12, n21, n22).step(k - 1)
      )
    } else {
      const n00 = this.nw.centeredSubnode()
      const n01 = this.nw.centeredHorizontal(this.ne)
      const n02 = this.ne.centeredSubnode()
      const n10 = this.nw.centeredVertical(this.sw)
      const n11 = this.centeredSubSubnode()
      const n12 = this.ne.centeredVertical(this.se)
      const n20 = this.sw.centeredSubnode()
      const n21 = this.sw.centeredHorizontal(this.se)
      const n22 = this.se.centeredSubnode()
      this.result = (this.constructor as any).create(
        (this.constructor as any).create(n00, n01, n10, n11).step(k),
        (this.constructor as any).create(n01, n02, n11, n12).step(k),
        (this.constructor as any).create(n10, n11, n20, n21).step(k),
        (this.constructor as any).create(n11, n12, n21, n22).step(k)
      )
    }
    this.resultStep = k
    return this.result
  }

  _cellList(ar: any[], dx: number, dy: number): void {
    if (this.pop === 0) return
    else if (this.level === 1) {
      if (this.nw) ar.push([dx - 1, dy - 1])
      if (this.ne) ar.push([dx, dy - 1])
      if (this.sw) ar.push([dx - 1, dy])
      if (this.se) ar.push([dx, dy])
    } else {
      const val = Math.pow(2, this.level - 2)
      this.nw._cellList(ar, dx - val, dy - val)
      this.ne._cellList(ar, dx + val, dy - val)
      this.sw._cellList(ar, dx - val, dy + val)
      this.se._cellList(ar, dx + val, dy + val)
    }
  }
}

TreeNode.pool = new Map()

export class LifeUniverse {
  root: TreeNode
  constructor() {
    this.root = TreeNode.emptyTree(3)
  }

  expandTo(x: number, y: number): void {
    while (
      Math.max(x, y) >= Math.pow(2, this.root.level - 1) ||
      Math.min(x, y) < -Math.pow(2, this.root.level - 1)
    ) {
      this.root = this.root.expand()
    }
  }

  get(x: number, y: number): any {
    this.expandTo(x, y)
    return this.root.getBit(x, y)
  }

  set(x: number, y: number, c: any): void {
    this.expandTo(x, y)
    this.root = this.root.setBit(x, y, c)
  }

  toggle(x: number, y: number): void {
    const cur = this.get(x, y)
    this.root = this.root.setBit(x, y, !cur)
  }

  step(k?: number): void {
    k = k || 0
    while (
      this.root.level < 2 + k ||
      this.root.centeredSubSubnode().pop !== this.root.pop
    )
      this.root = this.root.expand()
    this.root = this.root.step(k)
  }

  get population(): number {
    return this.root.pop
  }

  cellList(): any[] {
    const ar: any[] = []
    this.root._cellList(ar, 0, 0)
    return ar
  }

  toRLE(): string {
    return encode(this.cellList())
  }

  static fromRLE(rle: string): LifeUniverse {
    const universe = new this()
    const cells = decode(rle)
    for (const [x, y] of cells) {
      universe.set(x, y, true)
    }
    return universe
  }
}
