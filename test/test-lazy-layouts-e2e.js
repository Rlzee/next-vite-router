/**
 * End-to-end guard for the `lazyLayouts: true` root-layout regression.
 *
 * The generated-code test in `test-route-types.js` only pins the *emitted* glob
 * strings. It cannot prove Vite's real matcher behaves: the recursive double-star
 * layout glob also matches the root `layout.tsx` (the `**` may consume zero
 * folders), so the lazy loader used to win the object spread, overwrite the eager
 * root entry, and `buildRouteTree` then threw "…claims the root…" on the very
 * first render. This test drives Vite's actual transform + module graph, so the
 * check only passes if the root really stays out of the lazy glob.
 *
 * It runs the app's `generateRoutes()` under Vite SSR (no browser), then asserts:
 *  - it does not throw,
 *  - the root layout stayed EAGER (a plain component, not a Suspense boundary),
 *  - a nested layout is still LAZY (a Suspense boundary), so the negative pattern
 *    excluded only the root and did not over-reach.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { test } from "node:test";
import { createServer } from "vite";
import { nextViteRouter } from "../dist/plugin.js";

/** Depth-first search for the first route whose `path` equals `wanted`. */
function findRoute(routes, wanted) {
  for (const route of routes) {
    if (route.path === wanted) return route;
    const found = route.children && findRoute(route.children, wanted);
    if (found) return found;
  }
  return undefined;
}

test("lazyLayouts keeps the root layout eager through the real Vite glob", async () => {
  const root = fs.mkdtempSync(path.join(path.resolve("test"), "lazy-e2e-"));
  fs.mkdirSync(path.join(root, "src", "app", "users"), { recursive: true });

  // `.tsx` files whose bodies use React.createElement, so no JSX runtime config
  // is needed and the only transforms are Vite's esbuild + `import.meta.glob`.
  const layoutFile = (label) =>
    `import React from "react";\n` +
    `export default function Layout({ children }) {\n` +
    `  return React.createElement("div", null, ${JSON.stringify(label)}, children);\n}\n`;
  const pageFile = (label) =>
    `import React from "react";\n` +
    `export default function Page() {\n` +
    `  return React.createElement("p", null, ${JSON.stringify(label)});\n}\n`;

  fs.writeFileSync(path.join(root, "src", "app", "layout.tsx"), layoutFile("ROOT"));
  fs.writeFileSync(path.join(root, "src", "app", "page.tsx"), pageFile("HOME"));
  fs.writeFileSync(path.join(root, "src", "app", "users", "layout.tsx"), layoutFile("USERS"));
  fs.writeFileSync(path.join(root, "src", "app", "users", "page.tsx"), pageFile("USERS-PAGE"));
  fs.writeFileSync(
    path.join(root, "src", "routes.ts"),
    `export { generateRoutes } from "next-vite-router/routes";\n`,
  );

  let server;
  try {
    server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      // Keep Vite from scanning/prebundling for the browser: this is an SSR load
      // of an externalized dependency tree, resolved from the repository root's
      // node_modules (the temp project lives under `test/`).
      optimizeDeps: { disabled: true },
      server: { middlewareMode: true, watch: null },
      plugins: [nextViteRouter({ lazyLayouts: true })],
    });

    const module = await server.ssrLoadModule("/src/routes.ts");
    // The regression threw inside generateRoutes() on the first render; returning
    // at all is the core assertion. The shapes below prove the merged record kept
    // the eager root while still lazily loading the nested layout.
    const routes = module.generateRoutes();
    assert.ok(Array.isArray(routes) && routes.length > 0, "generateRoutes returned routes");

    const rootRoute = findRoute(routes, "/");
    assert.ok(rootRoute, 'a "/" root route is emitted');
    assert.notEqual(
      rootRoute.element.type,
      React.Suspense,
      "the root layout stayed eager - a lazy glob entry reached buildRouteTree",
    );
    assert.equal(typeof rootRoute.element.type, "function", "the eager root renders its component");

    const nestedRoute = findRoute(routes, "users");
    assert.ok(nestedRoute, 'a "users" nested route is emitted');
    assert.equal(
      nestedRoute.element.type,
      React.Suspense,
      "a nested layout stays lazy, so the negative pattern excluded only the root",
    );
  } finally {
    await server?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
