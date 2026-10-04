import type { DitherAlgo, ToneParams } from './dither';
import type { StyleParams } from './render';

export interface Settings extends ToneParams, StyleParams {
  cols: number;
  levels: number;
  algo: DitherAlgo;
  maskThreshold: number;
}

export interface Preset {
  name: string;
  hint: string;
  settings: Partial<Settings>;
}

export const DEFAULTS: Settings = {
  cols: 140,
  levels: 4,
  algo: 'atkinson',
  maskThreshold: 0.5,
  autoLevels: true,
  brightness: 0,
  contrast: 0.2,
  gamma: 1,
  invert: false,
  shape: 'square',
  gap: 0.2,
  ink: '#23406f',
  highlight: '#a7b7d1',
  sizeByTone: false,
  background: '#eceff3',
  transparent: false,
};

export const PRESETS: Preset[] = [
  {
    name: 'Engraving',
    hint: 'Navy dot-matrix, crumbly highlights',
    settings: { cols: 140, levels: 4, algo: 'atkinson', shape: 'square', gap: 0.2, sizeByTone: false, contrast: 0.2, gamma: 1, ink: '#23406f', highlight: '#a7b7d1', background: '#eceff3' },
  },
  {
    name: 'LED',
    hint: 'Round lamps on an ordered grid',
    settings: { cols: 90, levels: 3, algo: 'bayer4', shape: 'circle', gap: 0.22, sizeByTone: false, contrast: 0.3, gamma: 1, ink: '#ff5a1f', highlight: '#5a2410', background: '#120c0a' },
  },
  {
    name: 'Halftone',
    hint: 'Newspaper dots that grow with shadow',
    settings: { cols: 110, levels: 6, algo: 'none', shape: 'circle', gap: 0, sizeByTone: true, contrast: 0.15, gamma: 1, ink: '#1b1b1b', highlight: '#1b1b1b', background: '#f3ede1' },
  },
  {
    name: 'Game Boy',
    hint: 'Four greens, chunky pixels',
    settings: { cols: 72, levels: 4, algo: 'bayer4', shape: 'square', gap: 0, sizeByTone: false, contrast: 0.25, gamma: 1, ink: '#0f380f', highlight: '#8bac0f', background: '#c4d69a' },
  },
  {
    name: '1-bit',
    hint: 'Pure black dots, classic Mac',
    settings: { cols: 160, levels: 2, algo: 'floyd-steinberg', shape: 'square', gap: 0.08, sizeByTone: false, contrast: 0.1, gamma: 1, ink: '#111111', highlight: '#111111', background: '#ffffff' },
  },
];

export const SCREENS = [
  { name: 'iPhone', width: 1179, height: 2556 },
  { name: 'iPhone Pro Max', width: 1320, height: 2868 },
  { name: 'Android', width: 1080, height: 2400 },
  { name: 'Desktop 1440p', width: 2560, height: 1440 },
  { name: 'Desktop 4K', width: 3840, height: 2160 },
];
