import { describe, expect, it } from 'vitest';
import { adjustTones, quantize, sampleGrid, trimGrid, type DitherAlgo } from './dither';

function solid(w: number, h: number, v: number, mask?: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(w * h * 4);
  const m = mask ? new Uint8Array(w * h) : null;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      data.set([v, v, v, 255], i * 4);
      if (m) m[i] = mask!(x, y);
    }
  return { width: w, height: h, data, mask: m };
}

const tone = { autoLevels: false, brightness: 0, contrast: 0, gamma: 1, invert: false };

describe('sampleGrid', () => {
  it('keeps the aspect ratio and averages darkness', () => {
    const s = sampleGrid(solid(100, 50, 0), 10);
    expect([s.cols, s.rows]).toEqual([10, 5]);
    expect(s.darkness.every((d) => Math.abs(d - 1) < 1e-6)).toBe(true);
    expect(s.coverage.every((c) => c === 1)).toBe(true);
  });

  it('reports mask coverage and ignores masked-out pixels for tone', () => {
    // Left half black + masked in, right half white + masked out.
    const img = solid(20, 10, 255, (x) => (x < 10 ? 255 : 0));
    for (let p = 0; p < 200; p++) if (p % 20 < 10) img.data.set([0, 0, 0], p * 4);
    const s = sampleGrid(img, 2);
    expect(s.coverage[0]).toBeCloseTo(1);
    expect(s.coverage[1]).toBeCloseTo(0);
    expect(s.darkness[0]).toBeCloseTo(1);
  });
});

describe('quantize', () => {
  const algos: DitherAlgo[] = ['none', 'floyd-steinberg', 'atkinson', 'bayer4', 'bayer8'];

  it.each(algos)('%s preserves average tone on a flat 50%% field', (algo) => {
    const n = 64;
    const tones = new Float32Array(n * n).fill(0.5);
    const cov = new Float32Array(n * n).fill(1);
    const g = quantize(tones, cov, n, n, { levels: 2, algo, maskThreshold: 0.5 });
    const mean = g.cells.reduce((a, b) => a + b, 0) / g.cells.length;
    if (algo === 'none') expect(mean).toBe(1); // round(0.5) with no dither
    else expect(mean).toBeCloseTo(0.5, 1);
  });

  it('never places dots outside the mask', () => {
    const n = 32;
    const tones = new Float32Array(n * n).fill(0.9);
    const cov = new Float32Array(n * n).map((_, i) => (i % n < n / 2 ? 1 : 0));
    for (const algo of algos) {
      const g = quantize(tones, cov, n, n, { levels: 4, algo, maskThreshold: 0.5 });
      for (let i = 0; i < g.cells.length; i++) if (cov[i] === 0) expect(g.cells[i]).toBe(0);
    }
  });

  it('outputs levels within range', () => {
    const tones = Float32Array.from({ length: 400 }, (_, i) => i / 399);
    const cov = new Float32Array(400).fill(1);
    const g = quantize(tones, cov, 20, 20, { levels: 5, algo: 'atkinson', maskThreshold: 0.5 });
    expect(Math.max(...g.cells)).toBeLessThanOrEqual(4);
    expect(g.cells[0]).toBe(0);
    expect(g.cells[399]).toBe(4);
  });
});

describe('adjustTones', () => {
  it('invert flips darkness', () => {
    const s = sampleGrid(solid(4, 4, 0), 2);
    expect(adjustTones(s, { ...tone, invert: true }, 0)[0]).toBeCloseTo(0);
  });

  it('auto levels stretches a narrow range to 0..1', () => {
    const s = { cols: 3, rows: 1, darkness: Float32Array.from([0.4, 0.5, 0.6]), coverage: new Float32Array(3).fill(1) };
    const out = adjustTones(s, { ...tone, autoLevels: true }, 0.5);
    expect(out[0]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo(1);
  });
});

describe('trimGrid', () => {
  it('crops to dots plus padding', () => {
    const cells = new Uint8Array(100);
    cells[5 * 10 + 5] = 1;
    const g = trimGrid({ cols: 10, rows: 10, levels: 2, cells }, 1);
    expect([g.cols, g.rows]).toEqual([3, 3]);
    expect(g.cells[4]).toBe(1);
  });
});
