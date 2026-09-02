/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: '.',
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // The sprite functions, the bestiary, the edition tables and the lore
        // corpus are bulk data that changes on a different cadence from the game
        // logic, and together they were four fifths of a single 1.8 MB chunk.
        // Splitting them keeps an edit to main.ts from invalidating the whole
        // cached bundle and lets the browser fetch and parse the pieces in
        // parallel. Every resulting chunk is under Rollup's 500 kB warning
        // threshold, so chunkSizeWarningLimit stays at its default.
        //
        // Everything here is statically imported, so this does not reduce the
        // bytes on a cold first load; use dynamic import() for that.
        //
        // Matching on an id substring rather than an explicit file list means a
        // new edition bestiary dropped into src/ai/editions/, or a new panel in
        // src/ui/, is chunked correctly without anyone remembering to come here.
        manualChunks(id) {
          const path = id.replace(/\\/g, '/');
          if (!path.includes('/src/')) return;
          if (path.includes('/src/entities/Sprites')) return 'sprites';
          if (path.includes('/src/entities/Monster')) return 'bestiary';
          if (path.includes('/src/ai/editions/')) return 'editions';
          if (path.includes('/src/ui/')) return 'ui';
          if (
            path.includes('/src/ai/DnDKnowledge') ||
            path.includes('/src/ai/DnDGrimoire') ||
            path.includes('/src/ai/LoreGenerator')
          ) {
            return 'lore';
          }
          return;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
