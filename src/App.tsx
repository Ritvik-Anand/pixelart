import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adjustTones, quantize, sampleGrid, trimGrid, type DitherAlgo, type DotGrid } from './lib/dither';
import { renderArtwork, renderSvg, renderWallpaper } from './lib/render';
import { DEFAULTS, PRESETS, SCREENS, type Settings } from './lib/presets';
import { MODELS } from './lib/models';
import { segmentImage } from './lib/segment';
import { downloadCanvas, downloadText, imageDataUrl, loadImage, maskPreview } from './lib/image';
import { Color, Range, Section, Segmented, Toggle } from './components/Controls';

type SegState =
  | { status: 'idle' }
  | { status: 'working'; text: string; pct?: number }
  | { status: 'done'; device: string }
  | { status: 'error'; text: string };

const ALGOS: Array<{ value: DitherAlgo; label: string }> = [
  { value: 'atkinson', label: 'Atkinson' },
  { value: 'floyd-steinberg', label: 'Floyd–S' },
  { value: 'bayer4', label: 'Bayer 4' },
  { value: 'bayer8', label: 'Bayer 8' },
  { value: 'none', label: 'None' },
];

export default function App() {
  const [source, setSource] = useState<ImageData | null>(null);
  const [hasAlpha, setHasAlpha] = useState(false);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('pixelart');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mask, setMask] = useState<Uint8Array | null>(null);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [seg, setSeg] = useState<SegState>({ status: 'idle' });
  const [model, setModel] = useState(MODELS[0].id);
  const [subjectOnly, setSubjectOnly] = useState(true);
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [preset, setPreset] = useState<string | null>(PRESETS[0].name);
  const [view, setView] = useState<'art' | 'wallpaper'>('art');
  const [screenIdx, setScreenIdx] = useState(0);
  const [wallScale, setWallScale] = useState(0.8);
  const [wallY, setWallY] = useState(0.62);
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const segRun = useRef(0);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS((prev) => ({ ...prev, [k]: v }));
    setPreset(null);
  };

  // ---- loading -------------------------------------------------------------
  const openFile = useCallback(async (file: File | Blob | null | undefined, name?: string) => {
    if (!file) return;
    setLoadError(null);
    try {
      const img = await loadImage(file);
      // Treat it as a cut-out only if a real share of it is transparent,
      // not just anti-aliased corners.
      let clear = 0;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 128) clear++;
      const alpha = clear > (img.width * img.height) / 100;
      setSource(img);
      setHasAlpha(alpha);
      setSrcUrl(imageDataUrl(img));
      setMask(null);
      setMaskUrl(null);
      setSeg({ status: 'idle' });
      setFileName((name ?? 'pixelart').replace(/\.[^.]+$/, '') || 'pixelart');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (item) openFile(item.getAsFile(), 'pasted');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [openFile]);

  // ---- background removal -------------------------------------------------
  // Images that already carry transparency are used as-is.
  const wantMask = subjectOnly && !hasAlpha;

  useEffect(() => {
    if (!source || !wantMask) return;
    const run = ++segRun.current;
    setMask(null);
    setMaskUrl(null);
    setSeg({ status: 'working', text: 'Preparing model…' });
    segmentImage(source, model, (p) => {
      if (run !== segRun.current) return;
      if (p.stage === 'download') {
        const pct = p.total ? (p.loaded ?? 0) / p.total : undefined;
        const mb = ((p.loaded ?? 0) / 1e6).toFixed(0);
        setSeg({ status: 'working', text: `Downloading model… ${mb} MB (first time only)`, pct });
      } else if (p.stage === 'load') {
        setSeg({ status: 'working', text: 'Loading model…' });
      } else {
        setSeg({ status: 'working', text: `Finding the subject (${p.device === 'webgpu' ? 'GPU' : 'CPU'})…` });
      }
    })
      .then(({ mask, device }) => {
        if (run !== segRun.current) return;
        setMask(mask);
        setMaskUrl(maskPreview(source, mask));
        setSeg({ status: 'done', device });
      })
      .catch((e) => {
        if (run !== segRun.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setSeg({ status: 'error', text: /fetch|network/i.test(msg) ? "couldn't download the model (are you offline?)" : msg });
      });
  }, [source, model, wantMask]);

  // ---- pixel pipeline ------------------------------------------------------
  const masked = wantMask ? mask : null;
  const useCoverage = !!masked || (subjectOnly && hasAlpha);
  const sampled = useMemo(
    () => (source ? sampleGrid({ width: source.width, height: source.height, data: source.data, mask: masked }, s.cols) : null),
    [source, masked, s.cols],
  );
  const grid: DotGrid | null = useMemo(() => {
    if (!sampled) return null;
    const thr = useCoverage ? s.maskThreshold : 0;
    const tones = adjustTones(sampled, s, thr);
    const q = quantize(tones, sampled.coverage, sampled.cols, sampled.rows, { levels: s.levels, algo: s.algo, maskThreshold: thr });
    return useCoverage ? trimGrid(q, 2) : q;
  }, [sampled, s, useCoverage]);

  const screen = SCREENS[screenIdx];

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !grid) return;
    const rendered =
      view === 'art'
        ? renderArtwork(grid, s, Math.max(2, Math.ceil(1400 / Math.max(grid.cols, grid.rows))))
        : renderWallpaper(grid, s, { width: screen.width, height: screen.height, scale: wallScale, y: wallY });
    el.width = rendered.width;
    el.height = rendered.height;
    el.getContext('2d')!.drawImage(rendered, 0, 0);
  }, [grid, s, view, screen, wallScale, wallY]);

  // ---- export --------------------------------------------------------------
  const [exportDot, setExportDot] = useState(8);
  const exportPng = () => grid && downloadCanvas(renderArtwork(grid, s, exportDot), `${fileName}-pixel.png`);
  const exportSvg = () => grid && downloadText(renderSvg(grid, s, 10), `${fileName}-pixel.svg`, 'image/svg+xml');
  const exportWall = () =>
    grid &&
    downloadCanvas(
      renderWallpaper(grid, s, { width: screen.width, height: screen.height, scale: wallScale, y: wallY }),
      `${fileName}-${screen.width}x${screen.height}.png`,
    );

  const applyPreset = (name: string) => {
    const p = PRESETS.find((x) => x.name === name);
    if (!p) return;
    setS((prev) => ({ ...prev, ...p.settings }));
    setPreset(name);
  };

  const modelInfo = MODELS.find((m) => m.id === model)!;

  return (
    <div
      className="app"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) openFile(f, f.name);
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <i /><i /><i /><i />
          </span>
          Pixelart
        </div>
        <span className="tag">Runs entirely in your browser. Your photos never leave your device.</span>
        <button className="btn" onClick={() => fileInput.current?.click()}>
          {source ? 'New image' : 'Upload'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openFile(f, f.name);
            e.target.value = '';
          }}
        />
      </header>

      <main className="layout">
        <section className={`stage ${view === 'wallpaper' ? 'is-wall' : ''}`} style={{ background: s.transparent ? undefined : s.background }}>
          {!source ? (
            <button className="drop" onClick={() => fileInput.current?.click()}>
              <strong>Drop an image here</strong>
              <span>or click to upload · paste works too</span>
              <small>Works best with one clear subject: a person, animal, statue or illustration.</small>
              {loadError && <em className="err">{loadError}</em>}
            </button>
          ) : (
            <>
              <div className="viewtabs">
                <Segmented
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'art', label: 'Artwork' },
                    { value: 'wallpaper', label: 'Wallpaper' },
                  ]}
                />
              </div>
              <div className={view === 'wallpaper' ? (screen.width > screen.height ? 'frame desk' : 'frame phone') : 'frame art'}>
                <canvas ref={canvasRef} className={s.transparent ? 'checker' : ''} />
              </div>
              {seg.status === 'working' && (
                <div className="status">
                  <span>{seg.text}</span>
                  {seg.pct !== undefined && <progress value={seg.pct} max={1} />}
                </div>
              )}
              {seg.status === 'error' && (
                <div className="status err">
                  Background removal failed: {seg.text}. Showing the whole image instead.
                </div>
              )}
            </>
          )}
          {dragging && <div className="dropping">Drop to load</div>}
        </section>

        <aside className="panel">
          <Section title="Style">
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.name} className={`preset ${preset === p.name ? 'on' : ''}`} onClick={() => applyPreset(p.name)} title={p.hint}>
                  {p.name}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Subject">
            <Toggle label="Remove background" checked={subjectOnly} onChange={setSubjectOnly} />
            {subjectOnly && !hasAlpha && (
              <>
                <Segmented
                  value={model}
                  onChange={setModel}
                  options={MODELS.map((m) => ({ value: m.id, label: m.label }))}
                />
                <p className="hint">
                  {modelInfo.note} · {modelInfo.license}
                  {seg.status === 'done' && ` · ran on ${seg.device === 'webgpu' ? 'GPU' : 'CPU'}`}
                </p>
              </>
            )}
            {subjectOnly && hasAlpha && <p className="hint">This image is already transparent, so it's used as-is.</p>}
            {subjectOnly && (
              <Range label="Mask edge" min={0.05} max={0.95} step={0.05} value={s.maskThreshold} onChange={(v) => set('maskThreshold', v)} fmt={(v) => `${Math.round(v * 100)}%`} />
            )}
            {(srcUrl || maskUrl) && (
              <div className="thumbs">
                {srcUrl && <img src={srcUrl} alt="Original" />}
                {maskUrl && <img src={maskUrl} alt="Cut-out" className="checker" />}
              </div>
            )}
          </Section>

          <Section title="Dots">
            <Range label="Grid width" min={24} max={300} step={2} value={s.cols} onChange={(v) => set('cols', v)} fmt={(v) => `${v} dots`} />
            <Range label="Tones" min={2} max={8} step={1} value={s.levels} onChange={(v) => set('levels', v)} fmt={(v) => (v === 2 ? '1 + paper' : `${v - 1} + paper`)} />
            <label className="field-label">Dither</label>
            <Segmented value={s.algo} onChange={(v) => set('algo', v)} options={ALGOS} small />
            <label className="field-label">Shape</label>
            <Segmented
              value={s.shape}
              onChange={(v) => set('shape', v)}
              options={[
                { value: 'square', label: 'Square' },
                { value: 'circle', label: 'Circle' },
              ]}
            />
            <Range label="Gap" min={0} max={0.7} step={0.02} value={s.gap} onChange={(v) => set('gap', v)} fmt={(v) => `${Math.round(v * 100)}%`} />
            <Toggle label="Halftone (size follows tone)" checked={s.sizeByTone} onChange={(v) => set('sizeByTone', v)} />
          </Section>

          <Section title="Tone">
            <Toggle label="Auto levels" checked={s.autoLevels} onChange={(v) => set('autoLevels', v)} />
            <Range label="Brightness" min={-0.6} max={0.6} step={0.02} value={s.brightness} onChange={(v) => set('brightness', v)} fmt={signed} />
            <Range label="Contrast" min={-0.6} max={0.9} step={0.02} value={s.contrast} onChange={(v) => set('contrast', v)} fmt={signed} />
            <Range label="Midtones" min={0.4} max={2.5} step={0.05} value={s.gamma} onChange={(v) => set('gamma', v)} fmt={(v) => v.toFixed(2)} />
            <Toggle label="Invert" checked={s.invert} onChange={(v) => set('invert', v)} />
          </Section>

          <Section title="Colour">
            <div className="colors">
              <Color label="Ink" value={s.ink} onChange={(v) => set('ink', v)} />
              {!s.sizeByTone && s.levels > 2 && <Color label="Light ink" value={s.highlight} onChange={(v) => set('highlight', v)} />}
              <Color label="Background" value={s.background} onChange={(v) => set('background', v)} disabled={s.transparent} />
            </div>
            <Toggle label="Transparent background" checked={s.transparent} onChange={(v) => set('transparent', v)} />
          </Section>

          {view === 'wallpaper' && (
            <Section title="Wallpaper">
              <select className="select" value={screenIdx} onChange={(e) => setScreenIdx(+e.target.value)}>
                {SCREENS.map((sc, i) => (
                  <option key={sc.name} value={i}>
                    {sc.name} · {sc.width}×{sc.height}
                  </option>
                ))}
              </select>
              <Range label="Size" min={0.2} max={1.2} step={0.02} value={wallScale} onChange={setWallScale} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Range label="Position" min={0} max={1} step={0.01} value={wallY} onChange={setWallY} fmt={(v) => `${Math.round(v * 100)}%`} />
            </Section>
          )}

          <Section title="Export">
            {view === 'wallpaper' ? (
              <button className="btn primary wide" disabled={!grid} onClick={exportWall}>
                Download wallpaper PNG
              </button>
            ) : (
              <>
                <Range label="Dot size" min={2} max={24} step={1} value={exportDot} onChange={setExportDot} fmt={(v) => (grid ? `${v}px · ${grid.cols * v}×${grid.rows * v}` : `${v}px`)} />
                <div className="row">
                  <button className="btn primary" disabled={!grid} onClick={exportPng}>PNG</button>
                  <button className="btn" disabled={!grid} onClick={exportSvg}>SVG</button>
                </div>
              </>
            )}
          </Section>
        </aside>
      </main>
    </div>
  );
}

function signed(v: number) {
  const n = Math.round(v * 100);
  return n > 0 ? `+${n}` : `${n}`;
}
