import type { DotGrid } from './dither';

export type DotShape = 'square' | 'circle';

export interface StyleParams {
  shape: DotShape;
  /** 0..0.9 fraction of each cell left empty around the dot */
  gap: number;
  /** Darkest ink */
  ink: string;
  /** Lightest ink (used for the faintest level when levels > 2) */
  highlight: string;
  /** Halftone mode: all dots use `ink`, darker levels draw bigger dots */
  sizeByTone: boolean;
  background: string;
  transparent: boolean;
}

/** Colour and relative size (0..1) for each ink level; index 0 is unused. */
export function levelStyles(g: DotGrid, s: StyleParams): Array<{ color: string; size: number }> {
  const out = [{ color: 'transparent', size: 0 }];
  const steps = g.levels - 1;
  for (let k = 1; k <= steps; k++) {
    const t = steps === 1 ? 1 : (k - 1) / (steps - 1);
    if (s.sizeByTone) {
      // Area proportional to ink amount.
      out.push({ color: s.ink, size: Math.sqrt(k / steps) });
    } else {
      out.push({ color: mixHex(s.highlight, s.ink, t), size: 1 });
    }
  }
  return out;
}

/** Draw the grid with its top-left corner at (ox, oy). */
export function drawGrid(ctx: CanvasRenderingContext2D, g: DotGrid, s: StyleParams, cellPx: number, ox = 0, oy = 0) {
  const styles = levelStyles(g, s);
  const inner = cellPx * (1 - clampGap(s.gap));
  for (let k = 1; k < styles.length; k++) {
    const { color, size } = styles[k];
    const d = inner * size;
    if (d <= 0) continue;
    const off = (cellPx - d) / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        if (g.cells[y * g.cols + x] !== k) continue;
        const px = ox + x * cellPx + off;
        const py = oy + y * cellPx + off;
        if (s.shape === 'circle') {
          ctx.moveTo(px + d, py + d / 2);
          ctx.arc(px + d / 2, py + d / 2, d / 2, 0, Math.PI * 2);
        } else {
          ctx.rect(px, py, d, d);
        }
      }
    }
    ctx.fill();
  }
}

/** Render the artwork alone, sized `cellPx` per dot. */
export function renderArtwork(g: DotGrid, s: StyleParams, cellPx: number, margin = 0): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((g.cols + margin * 2) * cellPx);
  canvas.height = Math.round((g.rows + margin * 2) * cellPx);
  const ctx = canvas.getContext('2d')!;
  if (!s.transparent) {
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawGrid(ctx, g, s, cellPx, margin * cellPx, margin * cellPx);
  return canvas;
}

export interface WallpaperParams {
  width: number;
  height: number;
  /** Subject width as a fraction of the screen width */
  scale: number;
  /** Vertical centre of the subject, 0 = top, 1 = bottom */
  y: number;
}

/** Render the artwork centred on a full-screen canvas. Dots snap to whole pixels. */
export function renderWallpaper(g: DotGrid, s: StyleParams, w: WallpaperParams): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w.width;
  canvas.height = w.height;
  const ctx = canvas.getContext('2d')!;
  if (!s.transparent) {
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, w.width, w.height);
  }
  const cellPx = Math.max(1, Math.round((w.width * w.scale) / g.cols));
  const artW = g.cols * cellPx;
  const artH = g.rows * cellPx;
  const ox = Math.round((w.width - artW) / 2);
  const oy = Math.round(w.height * w.y - artH / 2);
  drawGrid(ctx, g, s, cellPx, ox, oy);
  return canvas;
}

/** Vector export: one <path> per ink level keeps files small. */
export function renderSvg(g: DotGrid, s: StyleParams, cellPx = 10): string {
  const styles = levelStyles(g, s);
  const inner = cellPx * (1 - clampGap(s.gap));
  const W = g.cols * cellPx;
  const H = g.rows * cellPx;
  const fmt = (n: number) => +n.toFixed(2);
  const parts: string[] = [];
  if (!s.transparent) parts.push(`<rect width="${W}" height="${H}" fill="${s.background}"/>`);
  for (let k = 1; k < styles.length; k++) {
    const { color, size } = styles[k];
    const d = fmt(inner * size);
    if (d <= 0) continue;
    const off = (cellPx - d) / 2;
    let path = '';
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        if (g.cells[y * g.cols + x] !== k) continue;
        const px = fmt(x * cellPx + off);
        const py = fmt(y * cellPx + off);
        if (s.shape === 'circle') {
          const r = fmt(d / 2);
          path += `M${fmt(px + d)} ${fmt(py + r)}a${r} ${r} 0 1 0 ${-d} 0a${r} ${r} 0 1 0 ${d} 0`;
        } else {
          path += `M${px} ${py}h${d}v${d}h${-d}z`;
        }
      }
    }
    if (path) parts.push(`<path fill="${color}" d="${path}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`;
}

function clampGap(g: number) {
  return Math.max(0, Math.min(0.9, g));
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function parseHex(h: string): [number, number, number] {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
