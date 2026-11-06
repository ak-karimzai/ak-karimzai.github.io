import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  resolve: {
    // Addons import from 'three'. Point that at the WebGPU build so the page ships one copy of three.js.
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
