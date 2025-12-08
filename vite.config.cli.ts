import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/cli.ts'),
      name: 'next-vite-router-cli',
      fileName: () => 'cli.cjs',
      formats: ['cjs']
    },
    outDir: 'dist',
    rollupOptions: {
      external: [
        'commander',
        'prompts',
        'fs',
        'path',
        'child_process',
        'node:child_process',
        'node:fs',
        'node:path',
      ],
      output: {
        entryFileNames: 'cli.cjs',
      }
    },
    target: 'node18',
    minify: false,
    emptyOutDir: false,
  }
});
