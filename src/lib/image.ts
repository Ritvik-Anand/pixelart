/** Longest side used for sampling and segmentation. Grids top out at ~300 cells. */
export const WORK_SIZE = 1600;

export async function loadImage(file: Blob): Promise<ImageData> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("Couldn't read that image. Try a JPG, PNG or WebP (HEIC only works in Safari).");
  }
  const scale = Math.min(1, WORK_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return ctx.getImageData(0, 0, w, h);
}

/** Preview of the cut-out: original pixels over a checkerboard where the mask is empty. */
export function maskPreview(img: ImageData, mask: Uint8Array): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  for (let i = 0; i < mask.length; i++) out.data[i * 4 + 3] = mask[i];
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}

export function imageDataUrl(img: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function download(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    download(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, 'image/png');
}

export function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  download(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
