import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        plugin: resolve(__dirname, 'src/plugin/index.plugin.ts'),
        // Internal runtime engine consumed by the generated
        // `next-vite-router/routes` module. It is emitted but intentionally left
        // out of package.json "exports", so it is unreachable by application
        // import.
        'plugin-runtime': resolve(__dirname, 'src/plugin-runtime.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) =>
        `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react-router-dom',
        'vite',
        'node:fs',
        'node:path',
        'node:url',
      ],
      output: {
        exports: 'named',
      },
    }
  },
  plugins: [
    dts({
      include: ['src'],
      outDir: 'dist',
      insertTypesEntry: true,
      rollupTypes: true,
    })
  ]
});