import type { WorkerRequest, WorkerResponse } from './segment.worker';

export type SegmentProgress = Extract<WorkerResponse, { type: 'progress' }>;

let worker: Worker | null = null;
let nextId = 1;

function getWorker() {
  worker ??= new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/** Run background removal off the main thread. Resolves with a 0..255 alpha mask. */
export function segmentImage(
  img: ImageData,
  model: string,
  onProgress?: (p: SegmentProgress) => void,
): Promise<{ mask: Uint8Array; device: string }> {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') return onProgress?.(msg);
      w.removeEventListener('message', onMessage);
      if (msg.type === 'result') resolve({ mask: msg.mask, device: msg.device });
      else reject(new Error(msg.message));
    };
    w.addEventListener('message', onMessage);
    // Copy so the caller keeps its ImageData intact.
    const data = new Uint8ClampedArray(img.data);
    const req: WorkerRequest = { type: 'segment', id, model, width: img.width, height: img.height, data };
    w.postMessage(req, [data.buffer]);
  });
}
