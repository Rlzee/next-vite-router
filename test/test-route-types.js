import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { nextViteRouter } from "../dist/plugin.js";
import { buildRouteTree } from "../dist/index.js";

const tscPath = path.resolve("node_modules", "typescript", "bin", "tsc");
const runTypeScript = (filePath, declarationFiles) => {
  const result = spawnSync(process.execPath, [
    tscPath,
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--module",
    "ESNext",
    "--moduleResolution",
    "bundler",
    "--target",
    "ES2020",
    "--jsx",
    "react-jsx",
    filePath,
    ...declarationFiles,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
};

// The generated route declaration must never be written into a tracked source
// folder, so copy the read-only fixture into a temporary project directory and
// run everything against that copy. The temp dir lives under `test/` so that
// TypeScript still resolves `node_modules` from the repo root and the fixture's
// relative `../../../dist/...` imports keep pointing at the built library.
const fixtureSource = path.resolve("test", "fixture");
const projectRoot = fs.mkdtempSync(path.join(path.resolve("test"), "route-types-"));
const declarationPath = path.join(projectRoot, "src", "virtual-next-vite-router.d.ts");

try {
  fs.cpSync(fixtureSource, projectRoot, { recursive: true });

  const plugin = nextViteRouter({
    pagesDir: "src/app",
  });

  plugin.configResolved({ root: projectRoot });

  const declaration = fs.readFileSync(declarationPath, "utf8");
  const virtualModule = plugin.load("\0virtual:next-vite-router");

  // The fixture keeps a checked-in copy of this declaration so that
  // `virtual:next-vite-router` resolves in an editor before anything has been
  // generated. Compare it against what the plugin just emitted (comments and
  // line endings ignored) so that copy can never drift from the real template.
  const withoutComments = (text) => text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .trim();
  assert.equal(
    withoutComments(
      fs.readFileSync(path.join(fixtureSource, "src", "virtual.d.ts"), "utf8"),
    ),
    withoutComments(declaration),
    "test/fixture/src/virtual.d.ts no longer matches the generated declaration; refresh it",
  );

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
  assert.match(declaration, /export function href<P extends RoutePath>/);
  assert.match(declaration, /export type RouteLinkProps =/);
  assert.match(declaration, /export function RouteLink\(props: RouteLinkProps\)/);
  assert.match(declaration, /export \{ Link, useRoutes \}/);
  assert.match(virtualModule, /import \{ Link, useRoutes \} from 'react-router-dom'/);
  assert.match(virtualModule, /export \{ Link, useRoutes \};/);
  assert.match(virtualModule, /export \{ href, RouteLink \};/);
  assert.match(virtualModule, /routes \?\?= generateRoutes\(\)/);
  assert.match(virtualModule, /import\.meta\.glob\(["']\/src\/app\/\*\*\/page\.tsx["']\)/);
  assert.match(virtualModule, /import\.meta\.glob\(["']\/src\/app\/\*\*\/not-found\.tsx["']\)/);
  assert.match(virtualModule, /import\.meta\.glob\(["']\/src\/app\/\*\*\/layout\.tsx["'], \{ eager: true \}\)/);
  assert.match(virtualModule, /import\.meta\.hot\.accept\(\(\) => \{\s*routes = undefined;/);

  runTypeScript(path.join(projectRoot, "src", "route-types.ts"), [declarationPath]);

  const invalidTypesPath = path.join(projectRoot, "src", "invalid-route-types.ts");
  fs.writeFileSync(invalidTypesPath, `
import { href } from "virtual:next-vite-router";
import type { RouteParams, RoutePath } from "virtual:next-vite-router";
import type { RouterConfig } from "../../../dist/index.js";

// @ts-expect-error unknown route path
const invalidPath: RoutePath = "/users/:missing";
// @ts-expect-error required route parameter is missing
const missingParam: RouteParams<"/users/:id"> = {};
// @ts-expect-error route parameters reject unknown keys
const extraParam: RouteParams<"/users/:id"> = { id: "123", extra: "nope" };
// @ts-expect-error pagesDir belongs to the plugin options, not RouterConfig
const invalidConfig: RouterConfig = { pagesDir: "src/app" };
// @ts-expect-error href requires the params of a pattern that has them
href("/users/:id");
// @ts-expect-error href rejects a parameter the pattern does not declare
href("/users/:id", { userId: "123" });
// @ts-expect-error href only accepts generated route patterns
href("/users/:missing", { id: "123" });
// @ts-expect-error href takes no params for a static route
href("/users", { id: "123" });
// @ts-expect-error a catch-all is addressed by its folder name, not by "*"
href("/blog/*", { "*": "guide/api" });

void invalidPath;
void missingParam;
void extraParam;
void invalidConfig;
`, "utf8");
  try {
    runTypeScript(invalidTypesPath, [declarationPath]);
  } finally {
    fs.rmSync(invalidTypesPath, { force: true });
  }

  const invalidLinkPath = path.join(projectRoot, "src", "invalid-route-links.tsx");
  fs.writeFileSync(invalidLinkPath, `
import { RouteLink } from "virtual:next-vite-router";

const profileLink = <RouteLink to="/users/:id" params={{ id: "123" }}>Profile</RouteLink>;
const missingParams = (
  // @ts-expect-error RouteLink requires params for a pattern that has them
  <RouteLink to="/users/:id">Profile</RouteLink>
);
const unknownRoute = (
  // @ts-expect-error RouteLink only accepts generated route patterns
  <RouteLink to="/users/:missing" params={{ id: "123" }}>Profile</RouteLink>
);
const staticWithParams = (
  // @ts-expect-error RouteLink rejects params for a static route
  <RouteLink to="/users" params={{ id: "123" }}>Users</RouteLink>
);

void profileLink;
void missingParams;
void unknownRoute;
void staticWithParams;
`, "utf8");
  try {
    runTypeScript(invalidLinkPath, [declarationPath]);
  } finally {
    fs.rmSync(invalidLinkPath, { force: true });
  }

  console.log("✅ Route declaration generated");
  console.log(`   ${declarationPath}`);
  console.log("✅ Static, dynamic, and grouped routes verified");
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

for (const invalidDirectory of ["compare/[id]/[id]", "users/[foo-bar]", "users/[1id]"]) {
  const invalidRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-invalid-"));
  const invalidPagesRoot = path.join(invalidRoot, "src", "app", invalidDirectory);
  fs.mkdirSync(invalidPagesRoot, { recursive: true });
  fs.writeFileSync(path.join(invalidPagesRoot, "page.tsx"), "");

  try {
    assert.throws(
      () => nextViteRouter().configResolved({ root: invalidRoot }),
      /(?:Duplicate route parameter|Invalid route parameter name)/,
    );
  } finally {
    fs.rmSync(invalidRoot, { recursive: true, force: true });
  }
}
console.log("✅ Invalid and repeated parameter names rejected");

for (const invalidDirectory of ["docs/[...slug]/edit", "docs/[[...slug]]/edit"]) {
  const invalidRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-catchall-"));
  const invalidPagesRoot = path.join(invalidRoot, "src", "app", invalidDirectory);
  fs.mkdirSync(invalidPagesRoot, { recursive: true });
  fs.writeFileSync(path.join(invalidPagesRoot, "page.tsx"), "");

  try {
    assert.throws(
      () => nextViteRouter().configResolved({ root: invalidRoot }),
      /catch-all segment .* must be the last segment/,
    );
  } finally {
    fs.rmSync(invalidRoot, { recursive: true, force: true });
  }
}
console.log("✅ Catch-all segments required to be the last segment");

assert.throws(
  () => nextViteRouter({ pageFile: "" }),
  /option "pageFile" must not be empty/,
);
assert.throws(
  () => nextViteRouter({ pageFile: "page.tsx", layoutFile: "page.tsx" }),
  /file options must be distinct/,
);
console.log("✅ Plugin options are validated");

const fallbackConflictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-fallback-"));
const fallbackPagesRoot = path.join(fallbackConflictRoot, "src", "app", "docs");
fs.mkdirSync(path.join(fallbackPagesRoot, "[...slug]"), { recursive: true });
fs.writeFileSync(path.join(fallbackPagesRoot, "[...slug]", "page.tsx"), "");
fs.writeFileSync(path.join(fallbackPagesRoot, "not-found.tsx"), "");
try {
  assert.throws(
    () => nextViteRouter().configResolved({ root: fallbackConflictRoot }),
    /Conflicting fallback routes "\/docs" detected/,
  );
} finally {
  fs.rmSync(fallbackConflictRoot, { recursive: true, force: true });
}
console.log("✅ Catch-all and not-found collisions rejected");

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
  const customTypesPath = path.join(customProjectRoot, "src", "custom-route-types.ts");
  const customDeclarationPath = path.join(
    customProjectRoot,
    "src",
    "virtual-next-vite-router.d.ts",
  );
  fs.writeFileSync(customTypesPath, `
import type { RouteParams, RoutePath } from "virtual:next-vite-router";

const user = "/users/:id" satisfies RoutePath;
const params: RouteParams<typeof user> = { id: "123" };

void params;
`, "utf8");
  try {
    runTypeScript(customTypesPath, [customDeclarationPath]);
  } finally {
    fs.rmSync(customTypesPath, { force: true });
  }
  console.log("✅ Custom route names compile with generated types");
  assert.match(
    customVirtualModule,
    /import\.meta\.glob\(["']\/src\/routes\/\*\*\/index\.tsx["']\)/,
  );
  assert.match(
    customVirtualModule,
    /import\.meta\.glob\(["']\/src\/routes\/\*\*\/missing\.tsx["']\)/,
  );
  assert.match(
    customVirtualModule,
    /import\.meta\.glob\(["']\/src\/routes\/\*\*\/layout\.tsx["'], \{ eager: true \}\)/,
  );
  assert.match(
    customVirtualModule,
    /import\.meta\.hot\.accept\(\(\) => \{\s*routes = undefined;/,
  );
  console.log("✅ Custom page, layout, not-found, and directory names verified");
} finally {
  fs.rmSync(customProjectRoot, { recursive: true, force: true });
}

const nestedAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-nested-"));
const nestedPagesRoot = path.join(nestedAppRoot, "app", "docs", "app");
fs.mkdirSync(nestedPagesRoot, { recursive: true });
fs.writeFileSync(path.join(nestedAppRoot, "app", "page.tsx"), "");
fs.writeFileSync(path.join(nestedPagesRoot, "page.tsx"), "");
try {
  const nestedPlugin = nextViteRouter({ pagesDir: "app" });
  nestedPlugin.configResolved({ root: nestedAppRoot });

  const nestedDeclaration = fs.readFileSync(
    path.join(nestedAppRoot, "virtual-next-vite-router.d.ts"),
    "utf8",
  );
  assert.match(nestedDeclaration, /\| "\/"/);
  assert.match(nestedDeclaration, /\| "\/docs\/app"/);

  const nestedTree = buildRouteTree(
    {
      "/app/page.tsx": () => Promise.resolve({ default: () => null }),
      "/app/docs/app/page.tsx": () => Promise.resolve({ default: () => null }),
    },
    {},
    {},
    { pagesDir: "app" },
  );
  assert.ok(nestedTree.page, "root page should be preserved");
  assert.ok(
    nestedTree.children.get("docs")?.children.get("app")?.page,
    "docs/app route should exist as a distinct page, not collapse to /",
  );
} finally {
  fs.rmSync(nestedAppRoot, { recursive: true, force: true });
}
console.log("✅ Nested folder matching pagesDir stays consistent between types and runtime");

const relativePagesDirRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-relative-"));
const relativeAppRoot = path.join(relativePagesDirRoot, "src", "app", "docs", "app");
fs.mkdirSync(relativeAppRoot, { recursive: true });
fs.writeFileSync(path.join(relativePagesDirRoot, "src", "app", "page.tsx"), "");
fs.writeFileSync(path.join(relativeAppRoot, "page.tsx"), "");
try {
  // `./src/app` must behave identically to `src/app`: the emitted glob and the
  // runtime base are normalized to the root-relative form Vite reports.
  const relativePlugin = nextViteRouter({ pagesDir: "./src/app" });
  relativePlugin.configResolved({ root: relativePagesDirRoot });

  const relativeVirtualModule = relativePlugin.load("\0virtual:next-vite-router");
  assert.match(
    relativeVirtualModule,
    /import\.meta\.glob\(["']\/src\/app\/\*\*\/page\.tsx["']\)/,
  );
  assert.match(relativeVirtualModule, /"pagesDir":"src\/app"/);

  const relativeDeclaration = fs.readFileSync(
    path.join(relativePagesDirRoot, "src", "virtual-next-vite-router.d.ts"),
    "utf8",
  );
  assert.match(relativeDeclaration, /\| "\/"/);
  assert.match(relativeDeclaration, /\| "\/docs\/app"/);
} finally {
  fs.rmSync(relativePagesDirRoot, { recursive: true, force: true });
}
console.log("✅ Relative ./ pagesDir spelling is normalized across glob, runtime, and types");

const backslashPagesDirRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-backslash-"));
const backslashAppRoot = path.join(backslashPagesDirRoot, "src", "app", "docs");
fs.mkdirSync(backslashAppRoot, { recursive: true });
fs.writeFileSync(path.join(backslashPagesDirRoot, "src", "app", "page.tsx"), "");
fs.writeFileSync(path.join(backslashAppRoot, "page.tsx"), "");
try {
  // `src\\app` must behave identically to `src/app`. On POSIX, resolving the
  // raw backslash form points at a folder literally named `src\\app`, so the
  // filesystem scan would find no pages and the generated types would lose the
  // routes; the physical pages root is normalized to guard against that.
  const backslashPlugin = nextViteRouter({ pagesDir: "src\\app" });
  backslashPlugin.configResolved({ root: backslashPagesDirRoot });

  const backslashVirtualModule = backslashPlugin.load("\0virtual:next-vite-router");
  assert.match(
    backslashVirtualModule,
    /import\.meta\.glob\(["']\/src\/app\/\*\*\/page\.tsx["']\)/,
  );
  assert.match(backslashVirtualModule, /"pagesDir":"src\/app"/);

  const backslashDeclaration = fs.readFileSync(
    path.join(backslashPagesDirRoot, "src", "virtual-next-vite-router.d.ts"),
    "utf8",
  );
  assert.match(backslashDeclaration, /\| "\/"/);
  assert.match(backslashDeclaration, /\| "\/docs"/);
} finally {
  fs.rmSync(backslashPagesDirRoot, { recursive: true, force: true });
}
console.log("✅ Backslash pagesDir is normalized to POSIX separators across glob, runtime, and types");

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
