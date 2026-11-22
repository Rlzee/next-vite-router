/**
 * Exercise Vite's real glob expansion, not just the generated source strings:
 * The recursive layout glob also matches the root, which must stay eager when
 * lazyLayouts is enabled. Vite's SSR loader is only the test harness here;
 * this guards the same generated route module consumed by client applications.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { test } from "node:test";
import { createServer } from "vite";
import { nextViteRouter } from "../dist/plugin.js";

function findRoute(routes, wanted) {
  for (const route of routes) {
    if (route.path === wanted) return route;
    const found = route.children && findRoute(route.children, wanted);
    if (found) return found;
  }
}

test("lazyLayouts keeps the root eager through Vite's real glob expansion", async () => {
  const root = fs.mkdtempSync(path.join(path.resolve("test"), "lazy-e2e-"));
  let server;
  try {
    fs.mkdirSync(path.join(root, "src", "app", "users"), { recursive: true });
    const layoutFile = (name) =>
      `import React from "react";\n` +
      `export default function ${name}({ children }) {\n` +
      `  return React.createElement("div", null, "${name}", children);\n}\n`;
    const pageFile = `import React from "react";
export default function Page() { return React.createElement("p", null, "PAGE"); }\n`;
    for (const [file, content] of [
      ["app/layout.tsx", layoutFile("RootLayout")],
      ["app/page.tsx", pageFile],
      ["app/users/layout.tsx", layoutFile("UsersLayout")],
      ["app/users/page.tsx", pageFile],
      ["routes.ts", `export { generateRoutes } from "next-vite-router/routes";\n`],
    ]) {
      fs.writeFileSync(path.join(root, "src", file), content);
    }

    server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, watch: null },
      plugins: [nextViteRouter({ lazyLayouts: true })],
    });

    const module = await server.ssrLoadModule("/src/routes.ts");
    const routes = module.generateRoutes();
    assert.ok(Array.isArray(routes) && routes.length > 0);

    const rootRoute = findRoute(routes, "/");
    assert.ok(rootRoute, "the root route exists");
    // main wraps each top-level element in the built-in not-found owner.
    // Inspect the actual layout inside it, not the wrapper's function type.
    assert.equal(typeof rootRoute.element.type, "function", "the root owner wraps the layout");
    const rootLayout = rootRoute.element.props.children;
    assert.equal(typeof rootLayout.type, "function", "the root layout is eager");
    assert.equal(rootLayout.type.name, "RootLayout");

    const nestedRoute = findRoute(routes, "users");
    assert.ok(nestedRoute, "the nested layout route exists");
    assert.equal(nestedRoute.element.type, React.Suspense, "the nested layout stays lazy");
    assert.equal(nestedRoute.element.props.children.type.$$typeof, Symbol.for("react.lazy"));
  } finally {
    await server?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
