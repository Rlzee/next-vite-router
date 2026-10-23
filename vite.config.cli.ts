import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/cli.ts"),
      name: "next-vite-router",
      fileName: () => "cli.cjs",
      formats: ["cjs"],
    },
    outDir: "dist",
    rollupOptions: {
      external: [
        "commander",
        "prompts",
        "kleur",
        /^node:/,
        "fs",
        "path",
        "os",
        "url",
        "child_process",
      ],
      output: {
        entryFileNames: "cli.cjs",
      },
    },
    // Matches the `engines.node` floor in package.json: down-leveling further
    // would only emit syntax for a runtime the CLI cannot run on anyway,
    // because commander itself requires Node >=20.
    target: "node20",
    minify: false,
    emptyOutDir: false,
  },
});
