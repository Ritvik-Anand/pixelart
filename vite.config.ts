import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // transformers.js ships its own wasm/onnx loaders; let Vite leave it alone.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
