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
const declarationPath = path.join(projectRoot, "src", "routes.d.ts");

try {
  fs.cpSync(fixtureSource, projectRoot, { recursive: true });

  const plugin = nextViteRouter({
    pagesDir: "src/app",
  });

  plugin.configResolved({ root: projectRoot });

  const declaration = fs.readFileSync(declarationPath, "utf8");
  const virtualModule = plugin.load("\0next-vite-router/routes");

  // `next-vite-router/routes` is the single public specifier; the older
  // `virtual:next-vite-router` name is no longer resolved at all.
  assert.equal(plugin.resolveId("next-vite-router/routes"), "\0next-vite-router/routes");
  assert.equal(plugin.resolveId("virtual:next-vite-router"), undefined);
  assert.equal(plugin.resolveId("some-other-module"), undefined);

  // The fixture keeps a checked-in copy of this declaration so that
  // `next-vite-router/routes` resolves in an editor before anything has been
  // generated. Compare it against what the plugin just emitted (comments and
  // line endings ignored) so that copy can never drift from the real template.
  const withoutComments = (text) => text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .trim();
  assert.equal(
    withoutComments(
      fs.readFileSync(path.join(fixtureSource, "src", "routes.placeholder.d.ts"), "utf8"),
    ),
    withoutComments(declaration),
    "test/fixture/src/routes.placeholder.d.ts no longer matches the generated declaration; refresh it",
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
  // `RoutePath` is emitted in code-unit order, so one folder tree always yields
  // the same declaration bytes on every machine and in every locale.
  assert.deepEqual(
    [...declaration.matchAll(/^ {2}\| "([^"]*)"/gm)].map(([, route]) => route),
    ["/", "/blog/*", "/docs", "/docs/*", "/posts/:slug", "/users", "/users/:id"],
  );
  assert.match(declaration, /id: string;/);
  // A catch-all also accepts the `useCatchAll()` segment array; a single-segment
  // param stays a plain string even when the folder names it `slug` too.
  assert.match(declaration, /"\/blog\/\*": \{\n\s+slug: string \| string\[\];/);
  assert.match(declaration, /"\/posts\/:slug": \{\n\s+slug: string;\n\s+\};/);
  assert.match(declaration, /segments\?: string \| string\[\];/);
  assert.match(declaration, /export function Router/);
  assert.match(declaration, /export function href<P extends RoutePath>/);
  assert.match(declaration, /export type LinkProps =/);
  assert.match(declaration, /export function Link\(props: LinkProps\)/);
  assert.match(declaration, /export function useCatchAll\(name\?: string\): string\[\];/);
  // The typed `Link` owns the `Link` name now, so React Router's own `Link` is
  // no longer re-exported; only `useRoutes` still comes from `react-router-dom`.
  assert.match(declaration, /export \{ useRoutes \}/);
  assert.doesNotMatch(declaration, /export \{ Link,/);
  // The single generated module is `next-vite-router/routes`; the old
  // `virtual:next-vite-router` name is gone from the declaration entirely.
  assert.match(declaration, /declare module 'next-vite-router\/routes' \{/);
  assert.doesNotMatch(declaration, /declare module 'virtual:next-vite-router'/);
  assert.match(virtualModule, /import \{ useRoutes \} from 'react-router-dom'/);
  assert.match(virtualModule, /export \{ useRoutes \};/);
  assert.match(virtualModule, /export \{ useParams, useCatchAll \};/);
  // The generated module binds each catch-all folder name into href/Link so the
  // runtime can validate the key: the "/blog/*" pattern alone cannot name its splat.
  // It reaches the engine by resolved file path (plugin-runtime is not in
  // "exports"), never as a `next-vite-router` specifier app code could reuse.
  assert.match(
    virtualModule,
    /import \{ buildRouteTree, treeToRoutes, useParams, useCatchAll, href as hrefBase, createTypedLink \} from ["'][^"']*plugin-runtime\.js["']/,
  );
  assert.doesNotMatch(virtualModule, /from ['"]next-vite-router['"]/);
  assert.match(
    virtualModule,
    /export function href\(pattern, params\) \{[\s\S]*?return hrefBase\(pattern, params, routeMetadata\[pattern\]\);/,
  );
  assert.match(virtualModule, /export const Link = createTypedLink\(routeMetadata\);/);
  assert.doesNotMatch(virtualModule, /export \{ href, Link \};/);
  // Each "*" pattern maps to the folder name it declares, required vs optional.
  assert.match(virtualModule, /const routeMetadata = \{/);
  assert.match(
    virtualModule,
    /"\/blog\/\*":\{"catchAll":\{"name":"slug","optional":false\}\}/,
  );
  assert.match(
    virtualModule,
    /"\/docs\/\*":\{"catchAll":\{"name":"segments","optional":true\}\}/,
  );
  // The generated module may only import what it uses or re-exports; a dead
  // import stays in the module graph of every app that loads the virtual module.
  assert.doesNotMatch(virtualModule, /createLazyElement/);
  assert.match(virtualModule, /routes \?\?= generateRoutes\(\)/);
  // Matching follows the case of the folder names, like Next.js: React Router
  // compiles a route pattern to a case-insensitive regexp unless the route
  // carries `caseSensitive: true`, so the generated call must pass the flag.
  assert.match(
    virtualModule,
    /const routes = treeToRoutes\(tree, true, "", undefined, undefined, true\);/,
  );
  assert.match(virtualModule, /import\.meta\.glob\(["']\/src\/app\/\*\*\/page\.tsx["']\)/);
  assert.match(virtualModule, /import\.meta\.glob\(["']\/src\/app\/\*\*\/not-found\.tsx["']\)/);
  assert.match(virtualModule, /import\.meta\.glob\(["']\/src\/app\/\*\*\/layout\.tsx["'], \{ eager: true \}\)/);
  // Layouts stay eager unless the plugin's `lazyLayouts` option is on, so the
  // default module must not declare a non-eager record shape either.
  assert.doesNotMatch(virtualModule, /layoutShape/);
  assert.match(virtualModule, /import\.meta\.hot\.accept\(\(\) => \{\s*routes = undefined;/);

  runTypeScript(path.join(projectRoot, "src", "route-types.ts"), [declarationPath]);

  const invalidTypesPath = path.join(projectRoot, "src", "invalid-route-types.ts");
  fs.writeFileSync(invalidTypesPath, `
import { href } from "next-vite-router/routes";
import type { RouteParams, RoutePath } from "next-vite-router/routes";
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
// A catch-all also takes the segment array \`useCatchAll()\` returns...
href("/blog/*", { slug: ["guide", "api"] });
// ...while a single-segment param stays a string.
// @ts-expect-error an array is only accepted for a catch-all value
href("/users/:id", { id: ["123"] });

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
import { Link } from "next-vite-router/routes";

const profileLink = <Link href="/users/:id" params={{ id: "123" }}>Profile</Link>;
const usersLink = <Link href="/users" className="list">Users</Link>;
const linkWithRouterProp = (
  // @ts-expect-error Link takes the Next.js \`href\`, not React Router's \`to\`
  <Link to="/users">Users</Link>
);
const linkMissingParams = (
  // @ts-expect-error Link requires params for a pattern that has them
  <Link href="/users/:id">Profile</Link>
);
const linkUnknownRoute = (
  // @ts-expect-error Link only accepts generated route patterns
  <Link href="/users/:missing" params={{ id: "123" }}>Profile</Link>
);
const linkStaticWithParams = (
  // @ts-expect-error Link rejects params for a static route
  <Link href="/users" params={{ id: "123" }}>Users</Link>
);

// A catch-all param accepts the segment array useCatchAll() returns...
const catchAllFromSegments = (
  <Link href="/blog/*" params={{ slug: ["guide", "api"] }}>Docs</Link>
);
// ...while a single-segment param stays a string.
const dynamicFromSegments = (
  // @ts-expect-error an array is only accepted for a catch-all value
  <Link href="/users/:id" params={{ id: ["123"] }}>Profile</Link>
);

void profileLink;
void usersLink;
void linkWithRouterProp;
void linkMissingParams;
void linkUnknownRoute;
void linkStaticWithParams;
void catchAllFromSegments;
void dynamicFromSegments;
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
// A boolean switch is checked by type, not by content: `"no"`, `1` and `null`
// are all truthy-or-odd values a destructuring default would accept, and
// `caseSensitive` is written into the generated module as it arrived, so
// `"no"` would have become a truthy `caseSensitive: "no"` in the built routes.
// The casts stand in for a JSON/ENV-authored config, which TypeScript cannot
// guard for this package.
for (const bad of ["no", "false", 1, null]) {
  assert.throws(
    () => nextViteRouter({ caseSensitive: bad }),
    /option "caseSensitive" must be a boolean/,
    `caseSensitive: ${JSON.stringify(bad)} must be rejected`,
  );
}
// `undefined` (absent key) is the documented way to take the default.
assert.doesNotThrow(() => nextViteRouter({ caseSensitive: undefined }));
console.log("✅ Plugin options are validated");

const fallbackConflictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-fallback-"));
const fallbackPagesRoot = path.join(fallbackConflictRoot, "src", "app", "docs");
fs.mkdirSync(path.join(fallbackPagesRoot, "[...slug]"), { recursive: true });
fs.writeFileSync(path.join(fallbackPagesRoot, "[...slug]", "page.tsx"), "");
fs.writeFileSync(path.join(fallbackPagesRoot, "[...slug]", "not-found.tsx"), "");
try {
  assert.throws(
    () => nextViteRouter().configResolved({ root: fallbackConflictRoot }),
    /Conflicting fallback routes "\/docs\/\*" detected/,
  );
} finally {
  fs.rmSync(fallbackConflictRoot, { recursive: true, force: true });
}
console.log("✅ Catch-all and not-found collisions rejected");

// A not-found one level UP from the catch-all folder is the fallback for its
// base URL (`/docs`), not a rival splat, so the plugin must accept it.
const fallbackPairRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-fallback-pair-"));
const fallbackPairPages = path.join(fallbackPairRoot, "src", "app", "docs");
fs.mkdirSync(path.join(fallbackPairPages, "[...slug]"), { recursive: true });
fs.writeFileSync(path.join(fallbackPairPages, "[...slug]", "page.tsx"), "");
fs.writeFileSync(path.join(fallbackPairPages, "not-found.tsx"), "");
try {
  const fallbackPairPlugin = nextViteRouter();
  fallbackPairPlugin.configResolved({ root: fallbackPairRoot });

  const fallbackPairDeclaration = fs.readFileSync(
    path.join(fallbackPairRoot, "src", "routes.d.ts"),
    "utf8",
  );
  assert.match(fallbackPairDeclaration, /\| "\/docs\/\*"/);
  assert.doesNotMatch(fallbackPairDeclaration, /\| "\/docs"/);
} finally {
  fs.rmSync(fallbackPairRoot, { recursive: true, force: true });
}
console.log("✅ Not-found accepted as the fallback of a catch-all base URL");

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
    path.join(customProjectRoot, "src", "routes.d.ts"),
    "utf8",
  );
  const customVirtualModule = customPlugin.load("\0next-vite-router/routes");

  assert.match(customDeclaration, /\| "\/"/);
  assert.match(customDeclaration, /\| "\/users"/);
  assert.match(customDeclaration, /\| "\/users\/:id"/);
  const customTypesPath = path.join(customProjectRoot, "src", "custom-route-types.ts");
  const customDeclarationPath = path.join(
    customProjectRoot,
    "src",
    "routes.d.ts",
  );
  fs.writeFileSync(customTypesPath, `
import type { RouteParams, RoutePath } from "next-vite-router/routes";

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

const lazyLayoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-lazy-layout-"));
fs.mkdirSync(path.join(lazyLayoutRoot, "src", "app"), { recursive: true });
fs.writeFileSync(path.join(lazyLayoutRoot, "src", "app", "page.tsx"), "");
try {
  // `lazyLayouts` has to flip both halves of the pair at once: the glob shape
  // Vite compiles, and the record shape the runtime reads. Only the option can
  // tell them apart, because a layout loader and a layout component are both
  // functions - so the generated module declares the shape next to the glob.
  const lazyLayoutPlugin = nextViteRouter({ lazyLayouts: true });
  lazyLayoutPlugin.configResolved({ root: lazyLayoutRoot });

  const lazyLayoutModule = lazyLayoutPlugin.load("\0next-vite-router/routes");
  assert.match(
    lazyLayoutModule,
    /const layoutsGlob = import\.meta\.glob\(["']\/src\/app\/\*\*\/layout\.tsx["']\);/,
  );
  assert.doesNotMatch(lazyLayoutModule, /layout\.tsx["'], \{ eager: true \}/);
  assert.match(
    lazyLayoutModule,
    /buildRouteTree\(\{ pages, layouts, notFounds, loadings, errors, fileOptions: \{[^}]*\} \}, \{ layoutShape: "loader" \}\)/,
  );
  // Pages and not-found files keep their own non-eager globs.
  assert.match(
    lazyLayoutModule,
    /const pagesGlob = import\.meta\.glob\(["']\/src\/app\/\*\*\/page\.tsx["']\);/,
  );
  console.log("✅ lazyLayouts pairs a non-eager layout glob with the runtime flag");
} finally {
  fs.rmSync(lazyLayoutRoot, { recursive: true, force: true });
}

const caseSensitiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-case-"));
fs.mkdirSync(path.join(caseSensitiveRoot, "src", "app"), { recursive: true });
fs.writeFileSync(path.join(caseSensitiveRoot, "src", "app", "page.tsx"), "");
try {
  // Matching is case-sensitive unless the plugin option opts the app back into
  // React Router's case-insensitive default; the flag reaches the routes only
  // through the generated `treeToRoutes` call, so pin that spelling too.
  const ciModule = nextViteRouter({ caseSensitive: false });
  ciModule.configResolved({ root: caseSensitiveRoot });
  assert.match(
    ciModule.load("\0next-vite-router/routes"),
    /const routes = treeToRoutes\(tree, true, "", undefined, undefined, false\);/,
  );
  console.log("✅ caseSensitive forwards the opt-out into the generated treeToRoutes call");
} finally {
  fs.rmSync(caseSensitiveRoot, { recursive: true, force: true });
}

// React Router v7 moved every export into `react-router` and left
// `react-router-dom` as a re-export shim that its own README tells a migrated
// application to remove. An install without the shim has to resolve the router
// through the core package, so the plugin reads what the project actually
// installed, contributes the alias Vite then applies to every import (this
// package's own `dist` included), and writes the generated module and the
// declaration against a specifier the project can resolve. These roots live
// outside the repository on purpose: resolution walks upward, so a directory
// under `test/` would find the workspace's own `react-router-dom`.
const routerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-router-"));
const routerRoot6 = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-router6-"));

// A minimal installed package: a manifest Node can resolve and a real entry file,
// which is all the plugin's lookup needs to answer for it.
function writeInstalledPackage(root, name, version) {
  const packageDir = path.join(root, "node_modules", name);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, "index.js"), "module.exports = {};\n");
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name, version, main: "index.js" }),
  );
}

function writeRouterApp(root) {
  fs.mkdirSync(path.join(root, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app", "page.tsx"), "");
}

try {
  writeRouterApp(routerRoot);
  writeInstalledPackage(routerRoot, "react-router", "7.18.4");

  const routerOnlyPlugin = nextViteRouter();
  const contributed = routerOnlyPlugin.config({ root: routerRoot });
  assert.deepEqual(
    contributed?.resolve?.alias,
    [{ find: /^react-router-dom$/, replacement: "react-router" }],
    "an install without react-router-dom must alias the shim onto react-router",
  );

  const routerOnlyWarnings = [];
  routerOnlyPlugin.configResolved({
    root: routerRoot,
    logger: { warn: (message) => routerOnlyWarnings.push(message) },
  });
  const routerOnlyModule = routerOnlyPlugin.load("\0next-vite-router/routes");
  const routerOnlyDeclaration = fs.readFileSync(
    path.join(routerRoot, "src", "routes.d.ts"),
    "utf8",
  );
  assert.match(routerOnlyModule, /import \{ useRoutes \} from 'react-router'/);
  assert.doesNotMatch(routerOnlyModule, /react-router-dom/);
  assert.match(
    routerOnlyDeclaration,
    /import type \{ LinkProps as ReactRouterLinkProps, RouteObject \} from 'react-router';/,
  );
  assert.doesNotMatch(routerOnlyDeclaration, /react-router-dom/);
  // Nothing to report: this install is served by the substitution.
  assert.deepEqual(routerOnlyWarnings, []);

  // The shim still wins as soon as it is installed, so an existing project keeps
  // the specifiers it has today and its own React Router imports stay untouched.
  writeInstalledPackage(routerRoot, "react-router-dom", "7.18.4");
  const shimPlugin = nextViteRouter();
  assert.equal(shimPlugin.config({ root: routerRoot }), undefined);
  const shimWarnings = [];
  shimPlugin.configResolved({
    root: routerRoot,
    logger: { warn: (message) => shimWarnings.push(message) },
  });
  assert.match(
    shimPlugin.load("\0next-vite-router/routes"),
    /import \{ useRoutes \} from 'react-router-dom'/,
  );
  assert.deepEqual(shimWarnings, []);

  // `react-router` v6 has no `Link`, so it cannot stand in for the shim. The
  // plugin leaves the specifier alone and says what to install, instead of
  // emitting imports for components the installed package does not export.
  writeRouterApp(routerRoot6);
  writeInstalledPackage(routerRoot6, "react-router", "6.30.6");
  const coreV6Plugin = nextViteRouter();
  assert.equal(coreV6Plugin.config({ root: routerRoot6 }), undefined);
  const coreV6Warnings = [];
  coreV6Plugin.configResolved({
    root: routerRoot6,
    logger: { warn: (message) => coreV6Warnings.push(message) },
  });
  assert.equal(coreV6Warnings.length, 1, "a v6-only install must be reported once");
  assert.match(coreV6Warnings[0], /"react-router" 6\.30\.6 is installed but "react-router-dom" is not/);
  assert.match(coreV6Warnings[0], /Install "react-router-dom@6"/);

  // And an install that has neither router package is left to Vite's own
  // "failed to resolve" error rather than a plugin message it does not need.
  const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-norouter-"));
  try {
    writeRouterApp(bareRoot);
    const barePlugin = nextViteRouter();
    assert.equal(barePlugin.config({ root: bareRoot }), undefined);
    const bareWarnings = [];
    barePlugin.configResolved({
      root: bareRoot,
      logger: { warn: (message) => bareWarnings.push(message) },
    });
    assert.deepEqual(bareWarnings, []);
  } finally {
    fs.rmSync(bareRoot, { recursive: true, force: true });
  }

  console.log("✅ react-router is substituted when the react-router-dom shim is absent");
} finally {
  fs.rmSync(routerRoot, { recursive: true, force: true });
  fs.rmSync(routerRoot6, { recursive: true, force: true });
}

// The `config` hook falls back to the process working directory when the user
// config carries no `root`, which is the same default Vite applies in
// `resolveConfig`. That branch cannot be exercised in this process: the suite runs
// from the repository, which installs `react-router-dom`, so "no root" and "the
// repository as root" answer the same and the fallback could be dead code without
// anything noticing. A child process whose working directory is a
// react-router-only project is the only configuration where the two differ.
const configCwdRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-cwd-"));
try {
  writeRouterApp(configCwdRoot);
  writeInstalledPackage(configCwdRoot, "react-router", "7.18.4");

  const probePath = path.join(configCwdRoot, "probe-config.mjs");
  fs.writeFileSync(probePath, `
import { pathToFileURL } from "node:url";

const { nextViteRouter } = await import(pathToFileURL(process.env.NVR_PLUGIN).href);
const contributed = nextViteRouter().config({});
const alias = contributed?.resolve?.alias;
process.stdout.write(JSON.stringify(alias ? alias.map((entry) => [String(entry.find), entry.replacement]) : null));
`, "utf8");

  const probe = spawnSync(process.execPath, [probePath], {
    encoding: "utf8",
    cwd: configCwdRoot,
    env: { ...process.env, NVR_PLUGIN: path.resolve("dist", "plugin.js") },
  });
  assert.equal(probe.status, 0, probe.stdout + probe.stderr);
  assert.deepEqual(
    JSON.parse(probe.stdout),
    [["/^react-router-dom$/", "react-router"]],
    "config() with no root must detect the router from the working directory",
  );

  // A relative `root` is resolved the way Vite resolves it, so a project opened
  // through a relative path is answered like the same project opened by name.
  const relativeContributed = nextViteRouter().config({
    root: path.relative(process.cwd(), configCwdRoot),
  });
  assert.deepEqual(
    relativeContributed?.resolve?.alias?.map((entry) => [
      String(entry.find),
      entry.replacement,
    ]),
    [["/^react-router-dom$/", "react-router"]],
    "a relative root must resolve against the working directory, as Vite does",
  );

  console.log("✅ router detection honors the configured root and the working directory");
} finally {
  fs.rmSync(configCwdRoot, { recursive: true, force: true });
}

// `routes.d.ts` is a name an application may already own, and the pre-rename
// declaration is a file an upgrading project still has on disk. Both decisions
// hinge on the marker this package writes, so both are pinned here: a foreign
// `routes.d.ts` is never overwritten, and a legacy copy is deleted only when this
// package wrote it - two bodies for one ambient module merge, and TypeScript then
// reports every alias inside as a duplicate identifier.
const declarationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-declaration-"));
const declarationMarker = "declare module 'next-vite-router/routes'";

function makeDeclarationProject(name) {
  const root = path.join(declarationRoot, name);
  fs.mkdirSync(path.join(root, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app", "page.tsx"), "");
  return root;
}

function runDeclarationWrite(root) {
  const warnings = [];
  const plugin = nextViteRouter();
  plugin.configResolved({
    root,
    logger: { warn: (message) => warnings.push(message) },
  });
  return warnings;
}

try {
  // The upgrade path: the new file is written and the stale copy this package
  // generated goes with it.
  const legacyRoot = makeDeclarationProject("legacy");
  const legacyPath = path.join(legacyRoot, "src", "virtual-next-vite-router.d.ts");
  fs.writeFileSync(legacyPath, `${declarationMarker} {\n  export type RoutePath = "/";\n}\n`);
  assert.deepEqual(runDeclarationWrite(legacyRoot), []);
  assert.ok(
    fs.existsSync(path.join(legacyRoot, "src", "routes.d.ts")),
    "the declaration must be written as routes.d.ts beside the pages directory",
  );
  assert.equal(
    fs.existsSync(legacyPath),
    false,
    "a stale declaration this package wrote must not survive next to the new one",
  );

  // A file under the old name that this package did not write is none of its
  // business, even though the name is one it used to generate.
  const keptRoot = makeDeclarationProject("kept-legacy");
  const keptPath = path.join(keptRoot, "src", "virtual-next-vite-router.d.ts");
  const keptContent = "export type RouteTable = { path: string };\n";
  fs.writeFileSync(keptPath, keptContent);
  runDeclarationWrite(keptRoot);
  assert.equal(fs.readFileSync(keptPath, "utf8"), keptContent);

  // And the same rule protects the new name: `routes.d.ts` is generic enough that
  // an application may have written its own, which a build must not replace.
  const ownedRoot = makeDeclarationProject("app-owned");
  const ownedPath = path.join(ownedRoot, "src", "routes.d.ts");
  const ownedContent = "export type AppRoutes = { checkout: string };\n";
  fs.writeFileSync(ownedPath, ownedContent);
  const ownedWarnings = runDeclarationWrite(ownedRoot);
  assert.equal(fs.readFileSync(ownedPath, "utf8"), ownedContent);
  assert.equal(ownedWarnings.length, 1, "refusing to write must be reported once");
  assert.match(ownedWarnings[0], /is not a file this plugin generated/);

  console.log("✅ routes.d.ts is only written, and old declarations only removed, by their author");
} finally {
  fs.rmSync(declarationRoot, { recursive: true, force: true });
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
    path.join(nestedAppRoot, "routes.d.ts"),
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

  const relativeVirtualModule = relativePlugin.load("\0next-vite-router/routes");
  assert.match(
    relativeVirtualModule,
    /import\.meta\.glob\(["']\/src\/app\/\*\*\/page\.tsx["']\)/,
  );
  assert.match(relativeVirtualModule, /"pagesDir":"src\/app"/);

  const relativeDeclaration = fs.readFileSync(
    path.join(relativePagesDirRoot, "src", "routes.d.ts"),
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

  const backslashVirtualModule = backslashPlugin.load("\0next-vite-router/routes");
  assert.match(
    backslashVirtualModule,
    /import\.meta\.glob\(["']\/src\/app\/\*\*\/page\.tsx["']\)/,
  );
  assert.match(backslashVirtualModule, /"pagesDir":"src\/app"/);

  const backslashDeclaration = fs.readFileSync(
    path.join(backslashPagesDirRoot, "src", "routes.d.ts"),
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
      getModuleById: () => ({ id: "\0next-vite-router/routes" }),
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
      path.join(hmrProjectRoot, "src", "routes.d.ts"),
      "utf8",
    );
    watcher.emit("add", path.join(hmrPagesRoot, "(contact)", "page.tsx"));
    assert.equal(reloads.length, 1);
    assert.equal(invalidations, 2);
    assert.equal(errors.length, 1);
    assert.equal(
      fs.readFileSync(
        path.join(hmrProjectRoot, "src", "routes.d.ts"),
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
