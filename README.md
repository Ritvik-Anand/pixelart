# Pixelart

Upload a photo, and Pixelart cuts out the main subject and redraws it as dithered dot-matrix art on a plain or transparent background. You can export it as a PNG, an SVG, or a phone/desktop wallpaper.

Everything runs in the browser. Photos are never uploaded anywhere.

## How it works

```
image ──► background removal (AI, in a Web Worker) ──► alpha mask
      └─► grid sampling ─► tone curve ─► quantize + dither ─► dots ─► canvas / SVG
```

1. **Subject cut-out.** A segmentation model runs through [transformers.js](https://github.com/huggingface/transformers.js), on WebGPU when available and on WASM otherwise. It is the only AI step. It's downloaded from the Hugging Face Hub on first use and cached by the browser.
   | Option | Model | Size | License |
   |---|---|---|---|
   | Fast (default) | `onnx-community/ormbg-ONNX` | 45–90 MB | Apache-2.0 |
   | Sharp edges | `onnx-community/BiRefNet_lite-ONNX` | 115–225 MB | MIT |

   Images that already have transparency (cut-out PNGs) skip this step.
2. **Dot engine** (`src/lib/dither.ts`). Plain deterministic code with no AI:
   - Averages each grid cell into darkness and subject coverage.
   - Applies auto levels, brightness, contrast and gamma.
   - Quantizes to N tones with Atkinson, Floyd–Steinberg, Bayer 4×4/8×8 or no dithering. Error diffusion only spreads inside the subject, so edges stay clean.
3. **Rendering** (`src/lib/render.ts`):
   - Square or round dots with a configurable gap.
   - Colour shades between two inks, or halftone mode, where dot size follows tone.
   - Exports a PNG, a compact SVG (one path per tone), or a wallpaper with the subject placed for a lock screen.

## Development

```bash
npm install        # if onnxruntime-node's postinstall fails, use: npm install --ignore-scripts
npm run dev        # http://localhost:5173
npm test           # unit tests for the dither engine
npm run build      # static site in dist/
```

The build is a static site, so it deploys to any static host (Vercel, Netlify, GitHub Pages). The bundled ONNX Runtime `.wasm` is about 27 MB, which is over Cloudflare Pages' 25 MB per-file limit.

## Ideas for next versions

- Tap-to-select the subject with SAM when the automatic cut-out picks the wrong thing
- Multi-colour palettes (posterize to a palette instead of one ink ramp)
- Sample gallery and shareable preset links
- Animated GIF/MP4 export (dots "assembling")
