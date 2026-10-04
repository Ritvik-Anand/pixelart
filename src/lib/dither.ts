// Pure image -> dot-grid pipeline. No DOM access, so it can be unit tested and
// moved into a worker later without changes.

export type DitherAlgo = 'none' | 'floyd-steinberg' | 'atkinson' | 'bayer4' | 'bayer8';

export interface SourceImage {
  width: number;
  height: number;
  /** RGBA, row-major, length = width * height * 4 */
  data: Uint8ClampedArray;
  /** Optional subject mask, 0..255, length = width * height */
  mask?: Uint8Array | null;
}

export interface Sampled {
  cols: number;
  rows: number;
  /** 0 = paper (no ink) .. 1 = full ink, one value per cell */
  darkness: Float32Array;
  /** 0..1 share of the cell covered by the subject */
  coverage: Float32Array;
}

export interface ToneParams {
  /** Stretch the subject's tonal range to fill 0..1 before other adjustments */
  autoLevels: boolean;
  /** -1..1, positive = lighter (less ink) */
  brightness: number;
  /** -1..1 */
  contrast: number;
  /** 0.2..5, >1 pushes midtones toward paper, <1 toward ink */
  gamma: number;
  invert: boolean;
}

export interface QuantizeParams {
  /** Number of output tones including "no dot" (2 = pure on/off) */
  levels: number;
  algo: DitherAlgo;
  /** Cells whose coverage is below this are treated as background */
  maskThreshold: number;
}

export interface DotGrid {
  cols: number;
  rows: number;
  levels: number;
  /** 0 = no dot, 1..levels-1 = ink level */
  cells: Uint8Array;
}

/** Average each grid cell of the source into darkness + subject coverage. */
export function sampleGrid(src: SourceImage, cols: number): Sampled {
  const { width: w, height: h, data, mask } = src;
  cols = Math.max(1, Math.min(Math.round(cols), w));
  const cell = w / cols;
  const rows = Math.max(1, Math.round(h / cell));
  const cellH = h / rows;
  const darkness = new Float32Array(cols * rows);
  const coverage = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor(r * cellH);
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((r + 1) * cellH)));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * cell);
      const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((c + 1) * cell)));
      let lum = 0;
      let weight = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        let p = y * w + x0;
        for (let x = x0; x < x1; x++, p++) {
          const i = p * 4;
          let a = data[i + 3] / 255;
          if (mask) a *= mask[p] / 255;
          lum += a * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
          weight += a;
          n++;
        }
      }
      const k = r * cols + c;
      coverage[k] = weight / n;
      darkness[k] = weight > 0 ? 1 - lum / weight / 255 : 0;
    }
  }
  return { cols, rows, darkness, coverage };
}

/** Apply levels / brightness / contrast / gamma. Returns a new array. */
export function adjustTones(s: Sampled, p: ToneParams, maskThreshold: number): Float32Array {
  const n = s.darkness.length;
  const out = new Float32Array(n);
  let lo = 0;
  let hi = 1;
  if (p.autoLevels) [lo, hi] = percentileRange(s, maskThreshold, 0.01, 0.99);
  const span = hi - lo > 1e-3 ? hi - lo : 1;
  // Classic contrast curve: slope tan((c+1)·π/4) around the midpoint.
  const slope = Math.tan(((clamp(p.contrast, -0.99, 0.99) + 1) * Math.PI) / 4);
  for (let i = 0; i < n; i++) {
    let v = s.darkness[i];
    if (p.invert) v = 1 - v;
    v = (v - lo) / span;
    v -= p.brightness;
    v = (v - 0.5) * slope + 0.5;
    v = clamp(v, 0, 1);
    v = Math.pow(v, p.gamma);
    out[i] = v;
  }
  return out;
}

function percentileRange(s: Sampled, maskThreshold: number, pLo: number, pHi: number): [number, number] {
  const vals: number[] = [];
  for (let i = 0; i < s.darkness.length; i++) {
    if (s.coverage[i] >= maskThreshold) vals.push(s.darkness[i]);
  }
  if (vals.length < 2) return [0, 1];
  vals.sort((a, b) => a - b);
  const at = (q: number) => vals[Math.min(vals.length - 1, Math.floor(q * (vals.length - 1)))];
  return [at(pLo), at(pHi)];
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const BAYER8 = buildBayer8();

function buildBayer8(): number[][] {
  const m: number[][] = [];
  for (let y = 0; y < 8; y++) {
    m.push([]);
    for (let x = 0; x < 8; x++) {
      const b = BAYER4[y % 4][x % 4];
      const q = (y >> 2) * 2 + (x >> 2);
      m[y].push(b * 4 + [0, 2, 3, 1][q]);
    }
  }
  return m;
}

type Kernel = Array<[dx: number, dy: number, weight: number]>;
const FLOYD: Kernel = [
  [1, 0, 7 / 16],
  [-1, 1, 3 / 16],
  [0, 1, 5 / 16],
  [1, 1, 1 / 16],
];
// Atkinson only diffuses 6/8 of the error, which blows out highlights into
// sparse speckles: the "engraving" look.
const ATKINSON: Kernel = [
  [1, 0, 1 / 8],
  [2, 0, 1 / 8],
  [-1, 1, 1 / 8],
  [0, 1, 1 / 8],
  [1, 1, 1 / 8],
  [0, 2, 1 / 8],
];

/** Snap tones to `levels` steps, dithering inside the subject only. */
export function quantize(tones: Float32Array, coverage: Float32Array, cols: number, rows: number, p: QuantizeParams): DotGrid {
  const L = Math.max(2, Math.min(16, Math.round(p.levels)));
  const steps = L - 1;
  const cells = new Uint8Array(cols * rows);
  const inside = (i: number) => coverage[i] >= p.maskThreshold;

  if (p.algo === 'floyd-steinberg' || p.algo === 'atkinson') {
    const kernel = p.algo === 'atkinson' ? ATKINSON : FLOYD;
    const buf = Float32Array.from(tones);
    for (let y = 0; y < rows; y++) {
      // Serpentine scan avoids directional "worm" artifacts.
      const ltr = y % 2 === 0;
      for (let j = 0; j < cols; j++) {
        const x = ltr ? j : cols - 1 - j;
        const i = y * cols + x;
        if (!inside(i)) continue;
        const old = buf[i];
        const q = Math.round(clamp(old, 0, 1) * steps);
        cells[i] = q;
        const err = old - q / steps;
        for (const [dx, dy, wgt] of kernel) {
          const nx = x + (ltr ? dx : -dx);
          const ny = y + dy;
          if (nx < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (inside(ni)) buf[ni] += err * wgt;
        }
      }
    }
  } else {
    const m = p.algo === 'bayer4' ? BAYER4 : p.algo === 'bayer8' ? BAYER8 : null;
    const n = m ? m.length : 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (!inside(i)) continue;
        const v = clamp(tones[i], 0, 1) * steps;
        const t = m ? (m[y % n][x % n] + 0.5) / (n * n) : 0.5;
        cells[i] = Math.min(steps, Math.floor(v + t));
      }
    }
  }
  return { cols, rows, levels: L, cells };
}

/** Crop a grid to the bounding box of its dots plus `pad` cells. */
export function trimGrid(g: DotGrid, pad = 0): DotGrid {
  let x0 = g.cols, y0 = g.rows, x1 = -1, y1 = -1;
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      if (g.cells[y * g.cols + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return g;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(g.cols - 1, x1 + pad);
  y1 = Math.min(g.rows - 1, y1 + pad);
  const cols = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  const cells = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    cells.set(g.cells.subarray((y + y0) * g.cols + x0, (y + y0) * g.cols + x0 + cols), y * cols);
  }
  return { cols, rows, levels: g.levels, cells };
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
