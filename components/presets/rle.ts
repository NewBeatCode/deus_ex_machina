export const RLE_RE = /^([0-9]*[bo$]|\s)*!/i

export function decode(rle: string): [number, number][] {
  const cells: [number, number][] = []
  let x = 0
  let y = 0
  let count = 0

  const cleanRle = rle.replace(/#.*$/gm, '').replace(/x\s*=\s*\d+.*$/im, '').trim()

  for (let i = 0; i < cleanRle.length; i++) {
    const char = cleanRle[i]
    if (char === '!') break
    if (char >= '0' && char <= '9') {
      count = count * 10 + parseInt(char, 10)
    } else if (char === 'b') {
      x += count || 1
      count = 0
    } else if (char === 'o') {
      const n = count || 1
      for (let c = 0; c < n; c++) {
        cells.push([x++, y])
      }
      count = 0
    } else if (char === '$') {
      y += count || 1
      x = 0
      count = 0
    }
  }

  return cells
}

export function encode(cells: [number, number][]): string {
  if (!cells || cells.length === 0) return '!'

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const map = new Set<string>()

  for (const [x, y] of cells) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    map.add(`${x},${y}`)
  }

  let rle = ''
  let emptyLines = 0

  for (let y = minY; y <= maxY; y++) {
    let lineRLE = ''
    let tag = ''
    let count = 0

    for (let x = minX; x <= maxX; x++) {
      const currentTag = map.has(`${x},${y}`) ? 'o' : 'b'
      if (tag === '') {
        tag = currentTag
        count = 1
      } else if (tag === currentTag) {
        count++
      } else {
        lineRLE += (count > 1 ? count : '') + tag
        tag = currentTag
        count = 1
      }
    }

    if (tag === 'o') {
      lineRLE += (count > 1 ? count : '') + tag
    }

    if (lineRLE === '') {
      emptyLines++
    } else {
      if (emptyLines > 0) {
        rle += (emptyLines > 1 ? emptyLines : '') + '$'
        emptyLines = 0
      }
      rle += lineRLE + '$'
    }
  }

  if (rle.endsWith('$')) {
    rle = rle.slice(0, -1)
  }
  return rle + '!'
}
