export interface ModelInfo {
  id: string;
  label: string;
  note: string;
  license: string;
  /** dtype per backend; picks which ONNX file is downloaded */
  dtype: { webgpu: string; wasm: string };
}

export const MODELS: ModelInfo[] = [
  {
    id: 'onnx-community/ormbg-ONNX',
    label: 'Fast',
    note: 'ormbg · ~45–90 MB download',
    license: 'Apache-2.0',
    dtype: { webgpu: 'fp16', wasm: 'q8' },
  },
  {
    id: 'onnx-community/BiRefNet_lite-ONNX',
    label: 'Sharp edges',
    note: 'BiRefNet lite · ~115–225 MB download, slower',
    license: 'MIT',
    dtype: { webgpu: 'fp16', wasm: 'fp32' },
  },
];
