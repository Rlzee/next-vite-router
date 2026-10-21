import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { matchRoutes } from "react-router-dom";
import {
  buildRouteTree,
  assertNoDuplicateRoutes,
  configureRouter,
  createLazyCache,
  createLazyElement,
  createRouteGenerator,
  clearLazyCache,
  resetRouterConfig,
  treeToRoutes,
} from "../dist/index.js";
import { extractRoutePath, parseRouteSegments } from "../dist/index.js";

const loader = (name) => async () => ({ default: name });
const component = (name) => function Component() {
  return React.createElement("div", null, name);
};

function createRoutes({ pages = {}, layouts = {}, notFounds = {}, rootLayout } = {}) {
  const tree = buildRouteTree(pages, layouts, notFounds);
  if (rootLayout) tree.layout = rootLayout;
  return treeToRoutes(tree, true);
}

function routeShape(routes) {
  return routes.map(({ path, index, children }) => {
    const shape = {};
    if (path !== undefined) shape.path = path;
    if (index !== undefined) shape.index = index;
    shape.children = children ? routeShape(children) : undefined;
    return shape;
  });
}

/**
 * Replace every node's `children` map with a getter that counts how often the
 * subtree is enumerated, so traversal cost can be asserted without timing.
 *
 * @param {object} root - The route tree returned by `buildRouteTree`.
 * @returns {Map<object, number>} Visits per node, keyed by the node itself.
 */
function instrumentChildrenReads(root) {
  const reads = new Map();
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.pop();
    const children = node.children;
    reads.set(node, 0);
    Object.defineProperty(node, "children", {
      configurable: true,
      get() {
        reads.set(node, reads.get(node) + 1);
        return children;
      },
    });
    queue.push(...children.values());
  }

  return reads;
}

beforeEach(() => {
  // Reset the module-level router configuration singleton so state cannot leak
  // between tests. The lazy component cache no longer needs resetting: every
  // treeToRoutes() call (and every generator) owns its own cache, so a shared
  // route key can no longer reuse a stale React.lazy component.
  resetRouterConfig();
});

describe("route generator", () => {
  test("generates the root page without a layout", () => {
    const routes = createRoutes({
      pages: { "page.tsx": loader("home") },
    });

    assert.deepEqual(routeShape(routes), [{ path: "/", children: undefined }]);
  });

  test("renders a page with child routes as an index route", () => {
    const routes = createRoutes({
      pages: {
        "users/page.tsx": loader("list"),
        "users/[id]/page.tsx": loader("detail"),
      },
    });

    assert.equal(routes[0].element, undefined);
    assert.equal(routes[0].children[0].index, true);
    assert.notEqual(routes[0].children[0].element, undefined);
    assert.equal(routes[0].children[1].path, ":id");
    assert.notEqual(routes[0].children[1].element, undefined);
  });

  test("resolves multiple dynamic parameters and exposes their values", () => {
    const routes = createRoutes({
      pages: {
        "compare/[from]/[to]/page.tsx": loader("compare"),
      },
    });

    const matches = matchRoutes(routes, "/compare/paris/berlin");
    assert.deepEqual(matches?.at(-1)?.params, {
      from: "paris",
      to: "berlin",
    });
    assert.equal(matches?.at(-1)?.route.path, ":to");
  });

  test("keeps root pages and child routes as sibling matches", () => {
    const routes = createRoutes({
      pages: {
        "page.tsx": loader("home"),
        "about/page.tsx": loader("about"),
      },
    });

    assert.equal(routes[0].path, "/");
    assert.equal(routes[0].element, undefined);
    assert.equal(routes[0].children[0].index, true);
    assert.equal(routes[0].children[1].path, "about");
  });

  test("generates static, dynamic, multi-parameter, and catch-all routes", () => {
    const routes = createRoutes({
      pages: {
        "about/page.tsx": loader("about"),
        "users/[id]/page.tsx": loader("user"),
        "compare/[from]/[to]/page.tsx": loader("compare"),
        "blog/[...slug]/page.tsx": loader("blog"),
        "docs/[[...segments]]/page.tsx": loader("docs"),
      },
    });

    assert.deepEqual(routeShape(routes), [
      { path: "about", children: undefined },
      { path: "blog", children: [{ path: "*", children: undefined }] },
      { path: "compare", children: [
        { path: ":from", children: [{ path: ":to", children: undefined }] },
      ] },
      { path: "docs", children: [
        { index: true, children: undefined },
        { path: "*", children: undefined },
      ] },
      { path: "users", children: [{ path: ":id", children: undefined }] },
    ]);
  });

  test("removes route groups while preserving their children", () => {
    const routes = createRoutes({
      pages: {
        "(admin)/dashboard/page.tsx": loader("dashboard"),
      },
    });

    assert.deepEqual(routeShape(routes), [
      { path: "dashboard", children: undefined },
    ]);
  });

  test("matches grouped routes without exposing the group in the URL", () => {
    const routes = createRoutes({
      pages: {
        "(admin)/dashboard/page.tsx": loader("dashboard"),
      },
    });

    const matches = matchRoutes(routes, "/dashboard");
    assert.equal(matches?.at(-1)?.route.path, "dashboard");
    assert.equal(matchRoutes(routes, "/admin/dashboard"), null);
  });

  test("rejects duplicate routes created by route groups", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "(a)/x/page.tsx",
        "(b)/x/page.tsx",
        "(c)/y/page.tsx",
        "(d)/y/page.tsx",
      ]),
      {
        message: [
          'Duplicate route "/x" detected:',
          "  (a)/x/page.tsx",
          "  (b)/x/page.tsx",
          "",
          'Duplicate route "/y" detected:',
          "  (c)/y/page.tsx",
          "  (d)/y/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("rejects dynamic collisions across groups omitted from the URL", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "(app)/(admin)/users/[id]/page.tsx",
        "(app)/(marketing)/users/[slug]/page.tsx",
      ]),
      {
        message: [
          'Ambiguous route pattern "/users/:param" detected:',
          "  (app)/(admin)/users/[id]/page.tsx",
          "  (app)/(marketing)/users/[slug]/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("rejects dynamic routes with different parameter names", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "users/[id]/page.tsx",
        "users/[slug]/page.tsx",
      ]),
      {
        message: [
          'Ambiguous route pattern "/users/:param" detected:',
          "  users/[id]/page.tsx",
          "  users/[slug]/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("rejects optional catch-all routes that collide with their base route", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "docs/page.tsx",
        "docs/[[...segments]]/page.tsx",
      ]),
      {
        message: [
          'Duplicate route "/docs" detected:',
          "  docs/[[...segments]]/page.tsx",
          "  docs/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("rejects required and optional catch-all routes with the same prefix", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "docs/[...segments]/page.tsx",
        "docs/[[...rest]]/page.tsx",
      ]),
      {
        message: [
          'Ambiguous route pattern "/docs/*" detected:',
          "  docs/[...segments]/page.tsx",
          "  docs/[[...rest]]/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("allows a required or optional catch-all as the final segment", () => {
    assert.doesNotThrow(() => parseRouteSegments("docs/[...slug]"));
    assert.doesNotThrow(() => parseRouteSegments("docs/[[...slug]]"));
  });

  test("rejects a segment after a required catch-all", () => {
    assert.throws(
      () => parseRouteSegments("docs/[...slug]/edit"),
      /catch-all segment "\[\.\.\.slug\]" must be the last segment/,
    );
  });

  test("rejects a segment after an optional catch-all", () => {
    assert.throws(
      () => parseRouteSegments("docs/[[...slug]]/edit"),
      /catch-all segment "\[\[\.\.\.slug\]\]" must be the last segment/,
    );
  });

  test("rejects a route group placed after a catch-all", () => {
    assert.throws(
      () => parseRouteSegments("docs/[...slug]/(marketing)"),
      /The "\(marketing\)" segment that follows it can never match/,
    );
  });

  test("rejects a misplaced catch-all when building routes", () => {
    assert.throws(
      () => createRoutes({
        pages: { "docs/[...slug]/edit/page.tsx": loader("edit") },
      }),
      /catch-all segment "\[\.\.\.slug\]" must be the last segment/,
    );
    assert.throws(
      () => createRoutes({
        pages: { "docs/[[...slug]]/edit/page.tsx": loader("edit") },
      }),
      /catch-all segment "\[\[\.\.\.slug\]\]" must be the last segment/,
    );
  });

  test("names the faulty file when a catch-all is misplaced", () => {
    assert.throws(
      () => assertNoDuplicateRoutes(["src/app/docs/[...slug]/edit/page.tsx"]),
      /Invalid route "src\/app\/docs\/\[\.\.\.slug\]\/edit\/page\.tsx"/,
    );
  });

  test("rejects not-found routes that conflict with catch-all pages", () => {
    assert.throws(
      () => buildRouteTree(
        {
          "docs/[...slug]/page.tsx": loader("docs"),
        },
        {},
        {
          "docs/not-found.tsx": loader("docs-not-found"),
        },
      ),
      {
        message: [
          'Conflicting fallback routes "/docs" detected:',
          "  catch-all page: docs/[...slug]/page.tsx",
          "  not-found file: docs/not-found.tsx",
          "A not-found route and a catch-all page cannot coexist at the same route level.",
        ].join("\n"),
      },
    );
  });

  test("rejects not-found files placed at a catch-all level", () => {
    assert.throws(
      () => buildRouteTree(
        {
          "docs/[[...slug]]/page.tsx": loader("docs"),
        },
        {},
        {
          "docs/[[...slug]]/not-found.tsx": loader("docs-not-found"),
        },
      ),
      /Conflicting fallback routes "\/docs\/\*" detected/,
    );
  });

  test("rejects not-found fallbacks alongside optional catch-all pages", () => {
    assert.throws(
      () => buildRouteTree(
        {
          "docs/[[...slug]]/page.tsx": loader("docs"),
        },
        {
          "docs/layout.tsx": { default: component("docs-layout") },
        },
        {
          "docs/not-found.tsx": loader("docs-not-found"),
        },
      ),
      /Conflicting fallback routes "\/docs" detected/,
    );
  });

    test("keeps pages and layouts declared directly in route groups", () => {
      const groupLayout = component("marketing");
      const routes = createRoutes({
        pages: {
          "(marketing)/page.tsx": loader("marketing"),
          "(marketing)/about/page.tsx": loader("about"),
        },
        layouts: {
          "(marketing)/layout.tsx": { default: groupLayout },
        },
      });

      assert.deepEqual(routeShape(routes), [{
        children: [
          { index: true, children: undefined },
          { path: "about", children: undefined },
        ],
      }]);
      assert.equal(routes[0].element.type, groupLayout);
    });

    test("generates not-found routes without requiring a layout", () => {
      const routes = createRoutes({
        pages: { "dashboard/page.tsx": loader("dashboard") },
        notFounds: {
          "dashboard/not-found.tsx": loader("dashboard-not-found"),
          "not-found.tsx": loader("root-not-found"),
        },
      });

      assert.deepEqual(routeShape(routes), [
        { path: "/", children: [
          { path: "dashboard", children: [
            { index: true, children: undefined },
            { path: "*", children: undefined },
          ] },
          { path: "*", children: undefined },
        ] },
      ]);
    });

    test("extracts paths using configured file names and directories", () => {
      assert.equal(
        extractRoutePath("C:\\project\\pages\\about\\page.jsx", {
          pagesDir: "C:\\project\\pages",
          pageFile: "page.jsx",
        }),
        "about",
      );
      assert.equal(
        extractRoutePath(
          "C:\\project\\src\\app.v2\\my pages\\about\\page.tsx",
          { pagesDir: "C:\\project\\src\\app.v2" },
        ),
        "my pages/about",
      );
      assert.equal(
        extractRoutePath(
          "C:\\project\\src\\appXv2\\about\\page.tsx",
          { pagesDir: "C:\\project\\src\\app.v2" },
        ),
        "C:/project/src/appXv2/about",
      );
    });

    test("strips the pages directory only once at the root", () => {
      // A nested folder named like pagesDir must survive the prefix strip.
      assert.equal(
        extractRoutePath("/app/docs/app/page.tsx", { pagesDir: "app" }),
        "docs/app",
      );
      assert.equal(extractRoutePath("/app/page.tsx", { pagesDir: "app" }), "");
      assert.equal(
        extractRoutePath("/src/app/docs/app/page.tsx", { pagesDir: "src/app" }),
        "docs/app",
      );
    });

    test("strips only the first app/pages root marker without pagesDir", () => {
      assert.equal(
        extractRoutePath("../../pages/docs/pages/page.tsx"),
        "docs/pages",
      );
      assert.equal(extractRoutePath("app/blog/app/page.tsx"), "blog/app");
    });

    test("normalizes relative pagesDir spellings", () => {
      // `./`, leading `/`, trailing `/`, and Windows separators must all resolve
      // to the same root-relative base and match Vite glob keys.
      const key = "/src/app/docs/app/page.tsx";
      for (const pagesDir of ["src/app", "./src/app", "/src/app", "src/app/", "src\\app", ".\\src\\app"]) {
        assert.equal(extractRoutePath(key, { pagesDir }), "docs/app", pagesDir);
        assert.equal(extractRoutePath("/src/app/page.tsx", { pagesDir }), "", pagesDir);
      }
    });

    test("does not treat a route as a duplicate when a folder matches pagesDir", () => {
      // Runtime glob keys and generated types must agree on /docs/app.
      assert.doesNotThrow(() =>
        buildRouteTree(
          {
            "/app/page.tsx": loader("home"),
            "/app/docs/app/page.tsx": loader("docs-app"),
          },
          {},
          {},
          { pagesDir: "app" },
        ),
      );
    });

  test("supports nested layouts, layout-only nodes, and not-found routes", () => {
    const rootLayout = component("root");
    const adminLayout = component("admin");
    const routes = createRoutes({
      rootLayout,
      pages: {
        "dashboard/page.tsx": loader("dashboard"),
      },
      layouts: {
        "dashboard/layout.tsx": { default: adminLayout },
      },
      notFounds: {
        "not-found.tsx": loader("root-not-found"),
        "dashboard/not-found.tsx": loader("admin-not-found"),
      },
    });

    assert.deepEqual(routeShape(routes), [{
      path: "/",
      children: [
        { path: "dashboard", children: [
          { index: true, children: undefined },
          { path: "*", children: undefined },
        ] },
        { path: "*", children: undefined },
      ],
    }]);
    assert.equal(routes[0].element.type, rootLayout);
    assert.equal(
      routes[0].children[0].children[0].element.type,
      React.Suspense,
    );

    const dashboardMissing = matchRoutes(routes, "/dashboard/missing");
    assert.deepEqual(
      dashboardMissing?.map(({ route }) => route.path ?? route.index),
      ["/", "dashboard", "*"],
    );
    assert.equal(matchRoutes(routes, "/unknown")?.at(-1)?.route.path, "*");
  });

  test("walks every node of a nested layout subtree exactly once", () => {
    // Layout levels used to enumerate their own subtree twice: once for the
    // eager `descendants` list that the layout branch discarded, and once
    // through `createNodeChildren`. That made generation cost grow as 2^depth.
    const depth = 12;
    const segments = [];
    const layouts = {};
    const pages = {};

    for (let level = 0; level < depth; level++) {
      segments.push(`l${level}`);
      const dir = segments.join("/");
      layouts[`${dir}/layout.tsx`] = { default: component(`l${level}`) };
      pages[`${dir}/page.tsx`] = loader(`l${level}`);
    }

    const tree = buildRouteTree(pages, layouts, {});
    const childrenReads = instrumentChildrenReads(tree);
    const routes = treeToRoutes(tree, true);

    // Root plus one node per layout level, each enumerated a single time.
    assert.equal(childrenReads.size, depth + 1);
    assert.deepEqual(
      [...childrenReads.values()],
      [...childrenReads.values()].map(() => 1),
    );

    // The generated tree is still complete: every layout matches, then the
    // deepest page as an index route.
    assert.deepEqual(
      matchRoutes(routes, `/${segments.join("/")}`)?.map(
        ({ route }) => route.path ?? route.index,
      ),
      [...segments, true],
    );
  });

  test("resolves catch-all pages under layouts", () => {
    const layout = component("docs-layout");
    const routes = createRoutes({
      layouts: {
        docs: { default: layout },
      },
      pages: {
        "docs/[...slug]/page.tsx": loader("docs"),
      },
    });

    const matches = matchRoutes(routes, "/docs/guide/api");
    assert.deepEqual(matches?.map(({ route }) => route.path ?? route.index), [
      "docs",
      "*",
    ]);
    assert.equal(matches?.at(-1)?.params["*"], "guide/api");
  });

  test("keeps only page entries supplied by the glob", () => {
    const routes = createRoutes({
      pages: {
        "valid/page.tsx": loader("valid"),
      },
    });

    assert.deepEqual(routeShape(routes), [
      { path: "valid", children: undefined },
    ]);
  });

  test("handles Windows paths and paths containing spaces", () => {
    const tree = buildRouteTree(
      { "my pages\\[id]\\page.tsx": loader("page") },
      {},
      {},
    );

    assert.deepEqual(routeShape(treeToRoutes(tree, true)), [
      { path: "my pages", children: [{ path: ":id", children: undefined }] },
    ]);
  });

  test("rejects colliding dynamic parameter names when building routes", () => {
    assert.throws(() => createRoutes({
      pages: {
        "users/[id]/page.tsx": loader("id"),
        "users/[slug]/page.tsx": loader("slug"),
      },
    }), /Ambiguous route pattern "\/users\/:param" detected/);
  });

  test("orders routes consistently regardless of glob insertion order", () => {
    const routes = createRoutes({
      pages: {
        "zebra/page.tsx": loader("zebra"),
        "about/page.tsx": loader("about"),
        "alpha/page.tsx": loader("alpha"),
      },
    });

    assert.deepEqual(routes.map((route) => route.path), [
      "about",
      "alpha",
      "zebra",
    ]);
  });

  test("creates lazy route elements behind a Suspense boundary", () => {
    const routes = createRoutes({
      pages: { "lazy/page.tsx": loader("lazy") },
    });
    assert.equal(routes[0].element.type, React.Suspense);
    assert.equal(typeof routes[0].element.props.fallback.type, "function");
    // Default fallback renders an empty div.
    assert.equal(
      renderToStaticMarkup(routes[0].element.props.fallback),
      "<div></div>",
    );
  });

  test("reads configureRouter at render time, after routes are generated", () => {
    // Reproduces the module-level `generateRoutes()` ordering: routes are built
    // before the app calls `configureRouter`, yet the fallback must apply.
    const routes = createRoutes({
      pages: { "late/page.tsx": loader("late") },
    });

    configureRouter({
      loadingFallback: () => React.createElement("p", null, "Loading…"),
    });
    assert.equal(
      renderToStaticMarkup(routes[0].element.props.fallback),
      "<p>Loading…</p>",
    );

    configureRouter({ enableLazyLoading: false });
    assert.equal(renderToStaticMarkup(routes[0].element.props.fallback), "");
  });
});

describe("lazy component cache", () => {
  // The lazy component is the single child rendered inside the Suspense
  // boundary that `createLazyElement` returns.
  const lazyOf = (element) => element.props.children.type;

  test("reuses the memoized component for the same key within one cache", () => {
    const cache = createLazyCache();
    const first = createLazyElement(loader("a"), "page:/x", cache);
    const second = createLazyElement(loader("b"), "page:/x", cache);

    // Same key hits the cache, so the second loader is ignored.
    assert.equal(lazyOf(first), lazyOf(second));
  });

  test("keeps components separate across independent caches", () => {
    const first = createLazyElement(loader("a"), "page:/x", createLazyCache());
    const second = createLazyElement(loader("b"), "page:/x", createLazyCache());

    assert.notEqual(lazyOf(first), lazyOf(second));
  });

  test("clearLazyCache(cache) forgets the components held by that cache", () => {
    const cache = createLazyCache();
    const before = lazyOf(createLazyElement(loader("a"), "page:/x", cache));

    clearLazyCache(cache);
    const after = lazyOf(createLazyElement(loader("a"), "page:/x", cache));

    assert.notEqual(before, after);
  });

  test("clearLazyCache() without a cache warns and clears nothing", () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(message);
    try {
      clearLazyCache();
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /no longer clears a global cache/);
  });

  test("repeated calls to one generator reuse its components", () => {
    const generate = createRouteGenerator(
      { "page.tsx": loader("home") },
      {},
      {},
    );

    assert.equal(lazyOf(generate()[0].element), lazyOf(generate()[0].element));
  });

  test("independent generators use their own loaders for the same route", () => {
    const generateA = createRouteGenerator(
      { "users/page.tsx": loader("a") },
      {},
      {},
    );
    const generateB = createRouteGenerator(
      { "users/page.tsx": loader("b") },
      {},
      {},
    );

    // Both resolve the same `page:users` key, but per-generator caches keep the
    // components (and therefore the wrapped loaders) isolated.
    assert.notEqual(
      lazyOf(generateA()[0].element),
      lazyOf(generateB()[0].element),
    );
  });

  test("two treeToRoutes() calls without a cache stay isolated", () => {
    const tree = buildRouteTree({ "users/page.tsx": loader("users") }, {}, {});
    const first = treeToRoutes(tree, true);
    const second = treeToRoutes(tree, true);

    // Each call builds its own default cache, so the same route key yields a
    // fresh React.lazy component instead of reusing the earlier call's.
    assert.notEqual(lazyOf(first[0].element), lazyOf(second[0].element));
  });

  test("a generator ignores a loader swapped for an already-cached route", () => {
    const pages = { "users/page.tsx": loader("A") };
    const generate = createRouteGenerator(pages, {}, {});
    const first = lazyOf(generate()[0].element);

    // Replace the loader for the same key and regenerate on the SAME generator.
    pages["users/page.tsx"] = loader("B");
    const second = lazyOf(generate()[0].element);

    // The cache hit keeps the original memoized component; loader B is ignored.
    assert.equal(first, second);
  });

  test("a fresh generator resolves the swapped loader", () => {
    const pages = { "users/page.tsx": loader("A") };
    const generateV1 = createRouteGenerator(pages, {}, {});
    const oldComponent = lazyOf(generateV1()[0].element);

    pages["users/page.tsx"] = loader("B");
    const generateV2 = createRouteGenerator(pages, {}, {});
    const newComponent = lazyOf(generateV2()[0].element);

    // The documented workaround: a new generator owns a new cache, so the
    // changed source produces a component wrapping the current loader.
    assert.notEqual(oldComponent, newComponent);
  });
});

describe("route file default exports", () => {
  const componentLoader = (name) => async () => ({ default: component(name) });

  test("rejects a layout module that has no default export", () => {
    // Layouts are imported eagerly, so the missing component used to be stored
    // as `undefined` and the layout silently vanished from the routes.
    assert.throws(
      () => buildRouteTree(
        { "dashboard/page.tsx": componentLoader("dashboard") },
        { "dashboard/layout.tsx": { metadata: "only named exports" } },
        {},
      ),
      {
        message: [
          'Route layout "dashboard/layout.tsx" does not default-export a React component.',
          "Add `export default` to the file, for example: `export default function Layout({ children }) { ... }`.",
        ].join("\n"),
      },
    );
  });

  test("rejects a page that resolves without a default export", () => {
    // Pages stay code-split, so the file is only known once its loader resolves;
    // the error must still name the file rather than surface as a render error.
    const tree = buildRouteTree(
      { "about/page.tsx": async () => ({ title: "about" }) },
      {},
      {},
    );

    assert.deepEqual(routeShape(treeToRoutes(tree, true)), [
      { path: "about", children: undefined },
    ]);

    return assert.rejects(
      () => tree.children.get("about").page(),
      {
        message: [
          'Route page "about/page.tsx" does not default-export a React component.',
          "Add `export default` to the file, for example: `export default function Page() { ... }`.",
        ].join("\n"),
      },
    );
  });

  test("rejects a not-found file that resolves without a default export", () => {
    const tree = buildRouteTree(
      { "dashboard/page.tsx": componentLoader("dashboard") },
      {},
      { "dashboard/not-found.tsx": async () => ({}) },
    );

    return assert.rejects(
      () => tree.children.get("dashboard").notFound(),
      {
        message: [
          'Route not-found "dashboard/not-found.tsx" does not default-export a React component.',
          "Add `export default` to the file, for example: `export default function NotFound() { ... }`.",
        ].join("\n"),
      },
    );
  });

  test("rejects a route file supplied as an eagerly imported module", () => {
    assert.throws(
      () => buildRouteTree(
        { "about/page.tsx": { default: component("about") } },
        {},
        {},
      ),
      {
        message: [
          'Route page "about/page.tsx" must be a lazy loader function such as `async () => import("...")`.',
          "Keep the page glob lazy (no `{ eager: true }`); received object.",
        ].join("\n"),
      },
    );
  });

  test("accepts wrapped components as default exports", async () => {
    const Base = component("base");
    const tree = buildRouteTree(
      {
        "memo/page.tsx": async () => ({ default: React.memo(Base) }),
        "ref/page.tsx": async () => ({ default: React.forwardRef(Base) }),
      },
      {
        "memo/layout.tsx": { default: React.memo(Base) },
        "ref/layout.tsx": { default: React.lazy(async () => ({ default: Base })) },
      },
      {},
    );

    // Layouts were validated while building the tree; `memo`, `forwardRef` and
    // `lazy` wrappers are components too, so the pages must resolve as well.
    await assert.doesNotReject(() => tree.children.get("memo").page());
    await assert.doesNotReject(() => tree.children.get("ref").page());
  });

  test("accepts route values unwrapped by the glob import option", async () => {
    // `import.meta.glob(pattern, { import: "default" })` yields the component
    // itself instead of a module namespace, so it must not be reported as a
    // missing default export.
    const About = component("about");
    const Layout = component("layout");
    const tree = buildRouteTree(
      { "about/page.tsx": async () => About },
      { "about/layout.tsx": Layout },
      {},
    );

    assert.equal(tree.children.get("about").layout, Layout);
    assert.deepEqual(await tree.children.get("about").page(), { default: About });
  });
});
