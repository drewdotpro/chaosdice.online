import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Three.js is ~540 kB minified (≈136 kB gzipped) and changes rarely, so it
    // gets its own chunk: returning visitors keep it cached across app releases.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\/]three[\/]/ }],
        },
      },
    },
  },
});
