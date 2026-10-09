import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nextViteRouter } from "../dist/plugin.js";

const projectRoot = path.resolve("test/fixture");
const declarationPath = path.join(projectRoot, "src", "virtual-next-vite-router.d.ts");

const plugin = nextViteRouter({
  pagesDir: "src/app",
});

plugin.configResolved({ root: projectRoot });

const declaration = fs.readFileSync(declarationPath, "utf8");
const virtualModule = plugin.load("\0virtual:next-vite-router");

assert.match(declaration, /export type RoutePath =/);
assert.match(declaration, /\| "\/"/);
assert.match(declaration, /\| "\/users"/);
assert.match(declaration, /\| "\/users\/:id"/);
assert.match(declaration, /\| "\/posts\/:slug"/);
assert.match(declaration, /\| "\/blog\/\*"/);
assert.match(declaration, /\| "\/docs\/\*"/);
assert.match(declaration, /\| "\/docs"/);
assert.doesNotMatch(declaration, /marketing/);
assert.match(declaration, /id: string;/);
assert.match(declaration, /slug: string;/);
assert.match(declaration, /segments\?: string;/);
assert.match(declaration, /export function Router/);
assert.match(declaration, /export \{ Link, useRoutes \}/);
assert.match(virtualModule, /import \{ Link, useRoutes \} from 'react-router-dom'/);
assert.match(virtualModule, /routes \?\?= generateRoutes\(\)/);
assert.match(virtualModule, /import\.meta\.glob\('\/src\/app\/\*\*\/page\.tsx'\)/);
assert.match(virtualModule, /import\.meta\.glob\('\/src\/app\/\*\*\/not-found\.tsx'\)/);
assert.match(virtualModule, /import\.meta\.glob\('\/src\/app\/\*\*\/layout\.tsx', \{ eager: true \}\)/);
assert.match(virtualModule, /import\.meta\.hot\.accept\(\(\) => \{\s*routes = undefined;/);

console.log("✅ Route declaration generated");
console.log(`   ${declarationPath}`);
console.log("✅ Static, dynamic, and grouped routes verified");

const customProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-"));
const customPagesRoot = path.join(customProjectRoot, "src", "routes");
fs.mkdirSync(path.join(customPagesRoot, "users", "[id]"), { recursive: true });
fs.writeFileSync(path.join(customPagesRoot, "index.tsx"), "");
fs.writeFileSync(path.join(customPagesRoot, "users", "index.tsx"), "");
fs.writeFileSync(path.join(customPagesRoot, "users", "[id]", "index.tsx"), "");
fs.writeFileSync(path.join(customPagesRoot, "layout.tsx"), "");
fs.writeFileSync(path.join(customPagesRoot, "missing.tsx"), "");

try {
  const customPlugin = nextViteRouter({
    pagesDir: "src/routes",
    pageFile: "index.tsx",
    layoutFile: "layout.tsx",
    notFoundFile: "missing.tsx",
  });
  customPlugin.configResolved({ root: customProjectRoot });

  const customDeclaration = fs.readFileSync(
    path.join(customProjectRoot, "src", "virtual-next-vite-router.d.ts"),
    "utf8",
  );
  const customVirtualModule = customPlugin.load("\0virtual:next-vite-router");

  assert.match(customDeclaration, /\| "\/"/);
  assert.match(customDeclaration, /\| "\/users"/);
  assert.match(customDeclaration, /\| "\/users\/:id"/);
  assert.match(
    customVirtualModule,
    /import\.meta\.glob\('\/src\/routes\/\*\*\/index\.tsx'\)/,
  );
  assert.match(
    customVirtualModule,
    /import\.meta\.glob\('\/src\/routes\/\*\*\/missing\.tsx'\)/,
  );
  assert.match(
    customVirtualModule,
    /import\.meta\.glob\('\/src\/routes\/\*\*\/layout\.tsx', \{ eager: true \}\)/,
  );
  assert.match(
    customVirtualModule,
    /import\.meta\.hot\.accept\(\(\) => \{\s*routes = undefined;/,
  );
  console.log("✅ Custom page, layout, not-found, and directory names verified");
} finally {
  fs.rmSync(customProjectRoot, { recursive: true, force: true });
}

const hmrProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-hmr-"));
const hmrPagesRoot = path.join(hmrProjectRoot, "src", "app");
fs.mkdirSync(hmrPagesRoot, { recursive: true });
fs.writeFileSync(path.join(hmrPagesRoot, "page.tsx"), "");

try {
  const hmrPlugin = nextViteRouter();
  hmrPlugin.configResolved({ root: hmrProjectRoot });
  const watcher = new EventEmitter();
  const reloads = [];
  const errors = [];
  let invalidations = 0;
  const hmrServer = {
    watcher,
    moduleGraph: {
      getModuleById: () => ({ id: "\0virtual:next-vite-router" }),
      invalidateModule: () => {
        invalidations += 1;
      },
    },
    ws: {
      send: (payload) => reloads.push(payload),
    },
    config: {
      logger: {
        error: (message) => errors.push(message),
      },
    },
  };

  hmrPlugin.configureServer(hmrServer);
  hmrPlugin.configureServer(hmrServer);
  assert.equal(watcher.listenerCount("add"), 1);
  assert.equal(watcher.listenerCount("unlink"), 1);

  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  let nextTimerId = 0;
  let clearedTimers = 0;
  globalThis.setTimeout = (callback) => {
    const timerId = ++nextTimerId;
    timers.set(timerId, { callback, cleared: false });
    return timerId;
  };
  globalThis.clearTimeout = (timerId) => {
    const timer = timers.get(timerId);
    if (timer) {
      timer.cleared = true;
      clearedTimers += 1;
    }
  };

  try {
    fs.mkdirSync(path.join(hmrPagesRoot, "contact"));
    fs.writeFileSync(path.join(hmrPagesRoot, "contact", "page.tsx"), "");
    watcher.emit("add", path.join(hmrPagesRoot, "contact", "page.tsx"));
    assert.equal(timers.size, 1);

    fs.mkdirSync(path.join(hmrPagesRoot, "help"));
    fs.writeFileSync(path.join(hmrPagesRoot, "help", "page.tsx"), "");
    watcher.emit("add", path.join(hmrPagesRoot, "help", "page.tsx"));
    assert.equal(timers.size, 2);
    assert.equal(clearedTimers, 1);
    for (const timer of timers.values()) {
      if (!timer.cleared) {
        timer.cleared = true;
        timer.callback();
      }
    }
    assert.equal(reloads.length, 1);
    assert.deepEqual(reloads[0], { type: "full-reload", path: "*" });
    assert.equal(invalidations, 2);

    fs.mkdirSync(path.join(hmrPagesRoot, "(contact)"));
    fs.writeFileSync(path.join(hmrPagesRoot, "(contact)", "page.tsx"), "");
    const declarationBeforeCollision = fs.readFileSync(
      path.join(hmrProjectRoot, "src", "virtual-next-vite-router.d.ts"),
      "utf8",
    );
    watcher.emit("add", path.join(hmrPagesRoot, "(contact)", "page.tsx"));
    assert.equal(reloads.length, 1);
    assert.equal(invalidations, 2);
    assert.equal(errors.length, 1);
    assert.equal(
      fs.readFileSync(
        path.join(hmrProjectRoot, "src", "virtual-next-vite-router.d.ts"),
        "utf8",
      ),
      declarationBeforeCollision,
    );

    watcher.emit("close");
    assert.equal(watcher.listenerCount("add"), 0);
    assert.equal(watcher.listenerCount("unlink"), 0);
    fs.rmSync(path.join(hmrPagesRoot, "(contact)"), { recursive: true, force: true });
    hmrPlugin.configureServer(hmrServer);
    assert.equal(watcher.listenerCount("add"), 1);
    assert.equal(watcher.listenerCount("unlink"), 1);
    watcher.emit("unlink", path.join(hmrPagesRoot, "(contact)", "page.tsx"));
    assert.equal(
      [...timers.values()].filter((timer) => !timer.cleared).length,
      1,
    );
    watcher.emit("close");
    assert.equal(clearedTimers, 2);

    for (const timer of timers.values()) {
      if (!timer.cleared) {
        timer.cleared = true;
        timer.callback();
      }
    }
    assert.equal(reloads.length, 1);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }

  console.log("✅ HMR watcher cleanup and collision fallback verified");
} finally {
  fs.rmSync(hmrProjectRoot, { recursive: true, force: true });
}
