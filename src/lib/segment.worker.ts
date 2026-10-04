/// <reference lib="webworker" />
import { pipeline, RawImage, env, type BackgroundRemovalPipeline } from '@huggingface/transformers';
import { MODELS } from './models';

env.allowLocalModels = false;

export type WorkerRequest = {
  type: 'segment';
  id: number;
  model: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: 'download' | 'load' | 'run'; loaded?: number; total?: number; device?: string }
  | { type: 'result'; id: number; mask: Uint8Array; device: string }
  | { type: 'error'; id: number; message: string };

const cache = new Map<string, Promise<BackgroundRemovalPipeline>>();
let preferWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

function load(modelId: string, device: 'webgpu' | 'wasm', id: number) {
  const key = `${modelId}|${device}`;
  let p = cache.get(key);
  if (!p) {
    const info = MODELS.find((m) => m.id === modelId);
    const files = new Map<string, { loaded: number; total: number }>();
    p = pipeline('background-removal', modelId, {
      device,
      dtype: (info?.dtype[device] ?? 'fp32') as 'fp32',
      progress_callback: (e: any) => {
        if (e.status === 'progress' && e.file) {
          files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
          let loaded = 0, total = 0;
          for (const f of files.values()) { loaded += f.loaded; total += f.total; }
          post({ type: 'progress', id, stage: 'download', loaded, total, device });
        } else if (e.status === 'ready') {
          post({ type: 'progress', id, stage: 'load', device });
        }
      },
    }) as Promise<BackgroundRemovalPipeline>;
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

async function segment(req: WorkerRequest, device: 'webgpu' | 'wasm'): Promise<Uint8Array> {
  const seg = await load(req.model, device, req.id);
  post({ type: 'progress', id: req.id, stage: 'run', device });
  const image = new RawImage(req.data, req.width, req.height, 4);
  const out = (await seg(image)) as RawImage | RawImage[];
  const rgba = Array.isArray(out) ? out[0] : out;
  // Output is the input image with the mask written into the alpha channel.
  const n = req.width * req.height;
  const mask = new Uint8Array(n);
  const ch = rgba.channels;
  for (let i = 0; i < n; i++) mask[i] = rgba.data[i * ch + ch - 1];
  return mask;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  if (req.type !== 'segment') return;
  try {
    let device: 'webgpu' | 'wasm' = preferWebGpu ? 'webgpu' : 'wasm';
    let mask: Uint8Array;
    try {
      mask = await segment(req, device);
    } catch (err) {
      // Network failures would fail on wasm too; only fall back for GPU errors.
      if (device !== 'webgpu' || /fetch|network/i.test(String(err))) throw err;
      // WebGPU support is still patchy across browsers/drivers; fall back to CPU.
      console.warn('WebGPU segmentation failed, retrying on wasm', err);
      preferWebGpu = false;
      device = 'wasm';
      mask = await segment(req, device);
    }
    post({ type: 'result', id: req.id, mask, device }, [mask.buffer]);
  } catch (err) {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
};

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}
