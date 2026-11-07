import { defineConfig } from "@playwright/test";
import { appDir, hmrDir, viteBin } from "./test/browser/vite-cli.js";
import { prepareWorkspace } from "./test/browser/prepare.js";

// Build the bundle and the HMR copy now, not from a `globalSetup`: Playwright
// launches `webServer` before any setup hook runs, and a server whose directory or
// bundle is missing takes the whole run down with it.
prepareWorkspace();

// Browser-level coverage for the fixture app in `test/browser-app`.
//
// The unit suites render through `react-dom/server`, which cannot mount a class
// error boundary's catch, cannot code-split, and has no history, no HMR and no
// address bar. Three projects cover the app the way a user does:
//
//   dev        `vite dev`     - per-module requests, so the `loading.tsx`
//                               placeholder can be pinned against a delayed page
//                               module, and generated chunks stay inspectable.
//   preview    `vite preview`  - the production build, so a deep URL exercises the
//                               SPA fallback and lazy layouts exercise real chunks.
//   dev-hmr    `vite dev`      - a throwaway copy of the app on its own port, the
//                               only place a route file may be created and deleted:
//                               a structural change reloads every client of that
//                               server, so it must not share one with the tests
//                               above.
//
// `url-parity.spec.js` runs in both of the first two: a request target has to
// read the same to this package's normalizer, to Chromium's URL parser and to the
// mounted router, and only a real browser says what the second of those is.
//
// Chromium only, and the servers are pinned to 127.0.0.1: on Windows `localhost`
// may resolve to `::1` while Vite binds the IPv4 loopback.

const DEV_PORT = 5371;
const PREVIEW_PORT = 5372;
const HMR_PORT = 5373;

/** @param {number} port */
const url = (port) => `http://127.0.0.1:${port}`;

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {number} port
 */
function serve(cwd, args, port) {
  return {
    command: `"${process.execPath}" "${viteBin}" ${args.join(" ")}`,
    cwd,
    url: url(port),
    // A developer may already have the fixture running; CI never does.
    reuseExistingServer: !process.env.CI,
    // Vite's startup banner is noise here, but its errors must not be: set
    // `PW_DEBUG_SERVER=1` to see the banner too when a server misbehaves.
    stdout: process.env.PW_DEBUG_SERVER ? "pipe" : "ignore",
    stderr: "pipe",
    timeout: 120_000,
  };
}

// `webServer` is a config-level option, not a project one: all three servers come
// up before the first test, whichever project it belongs to.
const servers = [
  serve(appDir, [`--port ${DEV_PORT} --strictPort`], DEV_PORT),
  serve(appDir, [`preview --port ${PREVIEW_PORT} --strictPort`], PREVIEW_PORT),
  serve(hmrDir, [`--port ${HMR_PORT} --strictPort`], HMR_PORT),
];

export default defineConfig({
  testDir: "./test/browser",
  // Each file owns its own state; the copy in `dev-hmr` keeps the HMR writes away
  // from the shared app.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  webServer: servers,
  use: {
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "dev",
      testMatch: ["app.spec.js", "dev.spec.js", "url-parity.spec.js"],
      use: { baseURL: url(DEV_PORT) },
    },
    {
      name: "preview",
      testMatch: ["app.spec.js", "build.spec.js", "url-parity.spec.js"],
      use: { baseURL: url(PREVIEW_PORT) },
    },
    {
      name: "dev-hmr",
      testMatch: ["hmr.spec.js"],
      use: { baseURL: url(HMR_PORT) },
    },
  ],
});
