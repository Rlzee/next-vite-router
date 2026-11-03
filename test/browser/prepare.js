import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { appDir, hmrDir, viteBin } from "./vite-cli.js";

/**
 * Prepare everything the three servers need, before any of them is launched.
 *
 * Two entry points, because Playwright loads this config once per worker and the
 * work must happen exactly once per run:
 *
 * - `pnpm run test:browser` runs `prepare-cli.js` first, which forces a full
 *   refresh (rebuild the bundle, re-copy the app) before Playwright starts;
 * - `playwright test` on its own only fills in what is missing here, so a bare
 *   invocation still works and no worker rebuilds under a running server.
 *
 * It cannot be a `globalSetup`: Playwright launches `webServer` before any setup
 * hook runs, and a server whose directory or bundle is missing takes the whole run
 * down with it.
 *
 * The two things prepared are the production bundle for `vite preview` - built
 * through the same `dist` the unit suites import, so the browser tests exercise the
 * published code path - and the throwaway copy of the app for the HMR project, the
 * only server allowed to see route files appear and disappear.
 */

// `node_modules` stays outside the copy on purpose: the copy resolves its
// dependencies by walking up to the fixture app's own links, which is also what
// keeps this instant instead of an install.
const EXCLUDED = /[\\/](node_modules|dist|hmr-run|\.vite|test-results|routes\.d\.ts)[\\/]/;

/**
 * Recursive copy that may place its destination inside its source.
 *
 * `fs.cpSync` refuses exactly that (`Cannot copy X to a subdirectory of self`),
 * and the copy has to live inside the app: Node's dependency lookup walks out of
 * `hmr-run` into the fixture app's `node_modules`, so no install and no symlink
 * is needed. The same walk keeps Vite's own dependency cache inside the copy
 * (`hmr-run/node_modules/.vite`) instead of sharing it with the app's server.
 *
 * A file the copy cannot overwrite is skipped rather than fatal: Windows locks a
 * file a surviving watcher still holds open, and the copy then already carries
 * that file from the run that left the watcher behind. Every file the fixture app
 * really changed is written again, and the route folder the HMR spec generates is
 * removed below, so the copy cannot disagree with the app.
 * @param {string} from @param {string} to
 */
function copyApp(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    if (EXCLUDED.test(`${source}/`) || entry.name === "routes.d.ts") {
      continue;
    }
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true });
      copyApp(source, target);
      continue;
    }
    try {
      copyFileSync(source, target);
    } catch (error) {
      const locked = error?.code === "EBUSY" || error?.code === "EPERM";
      if (!locked || !existsSync(target)) {
        throw error;
      }
    }
  }
}

export function prepareWorkspace({ force = false } = {}) {
  // A previous crash may have left the generated route folder behind, in the app
  // and in the copy: the HMR spec asserts its route is absent when it starts.
  // Idempotent, so every caller can do it without a lock.
  rmSync(join(appDir, "src/app/hmr-live"), { recursive: true, force: true, maxRetries: 3 });
  rmSync(join(hmrDir, "src/app/hmr-live"), { recursive: true, force: true, maxRetries: 3 });

  // The copy is refreshed in place rather than deleted: a dev server left behind
  // by an interrupted run keeps its working directory locked on Windows, and every
  // file the app has is written over the old copy anyway.
  const alreadyPrepared =
    existsSync(join(appDir, "dist/index.html")) && existsSync(join(hmrDir, "src/main.tsx"));
  if (!force && alreadyPrepared) {
    return;
  }

  execFileSync(process.execPath, [viteBin, "build"], {
    cwd: appDir,
    stdio: process.env.CI ? "inherit" : "ignore",
  });

  mkdirSync(hmrDir, { recursive: true });
  copyApp(appDir, hmrDir);
  if (!existsSync(join(hmrDir, "src/main.tsx"))) {
    throw new Error(`HMR copy is missing its entry: ${hmrDir}`);
  }
}
