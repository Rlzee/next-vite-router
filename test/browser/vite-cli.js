import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const requireFromHere = createRequire(import.meta.url);

/**
 * The `vite` CLI as a file path, to be run through `process.execPath`.
 *
 * `vite/bin/vite.js` is not in the package `exports` map, so it cannot be resolved
 * as a subpath; the package folder comes from `vite/package.json` (which is
 * exported) and the CLI is read from the manifest's own `bin` entry. Going to the
 * JS file instead of `node_modules/.bin/vite` means no `.cmd` shim has to be
 * resolved on Windows and no package manager has to be on the PATH in CI.
 */
const packageDir = dirname(requireFromHere.resolve("vite/package.json"));
const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const binEntry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.vite;

export const viteBin = join(packageDir, binEntry);

/** The fixture app the browser suite serves in dev and from its production build. */
export const appDir = fileURLToPath(new URL("../browser-app", import.meta.url));

/**
 * The throwaway copy only the HMR project writes into.
 *
 * It lives inside the fixture app so Node's dependency lookup walks out of the copy
 * into the app's `node_modules` - no install and no symlink - and Vite keeps its
 * own dependency cache under the copy instead of sharing the app's.
 */
export const hmrDir = join(appDir, "hmr-run");

/** @param {string[]} segments path inside the built bundle of the fixture app. */
export const distPath = (...segments) => join(appDir, "dist", ...segments);
