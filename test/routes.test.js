import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { matchRoutes, MemoryRouter } from "react-router-dom";
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
// The navigation engine is not on the public root entry; the generated routes
// module re-exports these, and tests import them from the internal build entry
// that the generated module itself resolves by path.
import {
  CatchAllParamProvider,
  createTypedLink,
  href,
  Link,
} from "../dist/plugin-runtime.js";

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

  test("generates a root required catch-all as a single splat", () => {
    // `src/app/[...slug]/page.tsx` makes the whole app one catch-all. It must
    // compile to a bare `"*"` route that also matches the site root.
    const routes = createRoutes({
      pages: { "[...slug]/page.tsx": loader("req") },
    });

    assert.deepEqual(routeShape(routes), [{ path: "*", children: undefined }]);
    assert.deepEqual(matchRoutes(routes, "/")?.at(-1)?.params, { "*": "" });
    assert.deepEqual(matchRoutes(routes, "/a/b")?.at(-1)?.params, { "*": "a/b" });
  });

  test("generates a root optional catch-all that matches the base path", () => {
    // `src/app/[[...segments]]/page.tsx` yields an index route for "/" plus the
    // splat for everything below it, mirroring the nested optional catch-all.
    const routes = createRoutes({
      pages: { "[[...segments]]/page.tsx": loader("opt") },
    });

    assert.deepEqual(routeShape(routes), [
      { index: true, children: undefined },
      { path: "*", children: undefined },
    ]);

    const base = matchRoutes(routes, "/");
    assert.equal(base?.at(-1)?.route.index, true);
    assert.deepEqual(base?.at(-1)?.params, {});
    assert.deepEqual(matchRoutes(routes, "/a/b")?.at(-1)?.params, { "*": "a/b" });
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

describe("lazy layouts", () => {
  // The lazy component is the single child rendered inside the Suspense
  // boundary that `createLazyElement` returns.
  const lazyOf = (element) => element.props.children.type;
  const componentLoader = (name) => async () => ({ default: component(name) });

  /**
   * Tree built from a non-eager layout glob: every layout entry is a loader, and
   * `{ lazyLayouts: true }` is what tells `buildRouteTree` to read it that way.
   */
  function createLazyLayoutRoutes({ pages, layouts }) {
    const tree = buildRouteTree(pages, layouts, {}, undefined, {
      lazyLayouts: true,
    });
    return { tree, routes: treeToRoutes(tree, true) };
  }

  test("reads a layout function as a loader only when lazyLayouts is on", async () => {
    const Shell = component("shell");
    const layouts = { "dashboard/layout.tsx": async () => ({ default: Shell }) };
    const pages = { "dashboard/page.tsx": componentLoader("dashboard") };

    // Without the option a function is read as the component itself (the shape
    // an `{ eager: true, import: "default" }` glob produces), stored in `layout`
    // and never in `lazyLayout`. A bare-function eager layout is guarded, so the
    // stored value is a wrapper rather than the exact reference.
    const eager = buildRouteTree(pages, layouts, {});
    assert.equal(typeof eager.children.get("dashboard").layout, "function");
    assert.equal(eager.children.get("dashboard").lazyLayout, undefined);

    const lazy = buildRouteTree(pages, layouts, {}, undefined, { lazyLayouts: true });
    assert.equal(lazy.children.get("dashboard").layout, undefined);
    assert.equal(typeof lazy.children.get("dashboard").lazyLayout, "function");
    assert.deepEqual(await lazy.children.get("dashboard").lazyLayout(), {
      default: Shell,
    });
  });

  test("suspends a lazy layout and paints it once its chunk resolves", async () => {
    const Shell = component("shell");
    configureRouter({
      loadingFallback: () => React.createElement("p", null, "Loading shell…"),
    });
    const { routes } = createLazyLayoutRoutes({
      pages: { "dashboard/page.tsx": componentLoader("dashboard") },
      layouts: { "dashboard/layout.tsx": componentLoader("shell") },
    });

    assert.deepEqual(routeShape(routes), [
      { path: "dashboard", children: [{ index: true, children: undefined }] },
    ]);
    assert.equal(routes[0].element.type, React.Suspense);
    // The first paint starts the import and shows the fallback; once the module
    // promise settles, the boundary renders the layout itself, which proves the
    // loader is wired to the lazy component instead of a stand-in.
    assert.match(
      renderToStaticMarkup(routes[0].element),
      /<p>Loading shell…<\/p>/,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(renderToStaticMarkup(routes[0].element), /<div>shell<\/div>/);
  });

  test("suspends the root layout too", () => {
    const { routes } = createLazyLayoutRoutes({
      pages: { "page.tsx": componentLoader("home") },
      layouts: { "layout.tsx": componentLoader("shell") },
    });

    assert.equal(routes[0].path, "/");
    assert.equal(routes[0].element.type, React.Suspense);
  });

  test("keeps the catch-all provider around a lazy layout", () => {
    const { routes } = createLazyLayoutRoutes({
      pages: { "docs/[...slug]/page.tsx": componentLoader("docs") },
      layouts: { "docs/[...slug]/layout.tsx": componentLoader("docs-shell") },
    });

    const layoutRoute = routes[0].children[0];
    assert.equal(layoutRoute.element.type, CatchAllParamProvider);
    assert.equal(layoutRoute.element.props.name, "slug");
    assert.equal(layoutRoute.element.props.children.type, React.Suspense);
  });

  test("accepts an eager module next to a lazy loader", () => {
    const Shell = component("shell");
    const { routes } = createLazyLayoutRoutes({
      pages: {
        "dashboard/page.tsx": componentLoader("dashboard"),
        "reports/page.tsx": componentLoader("reports"),
      },
      layouts: {
        "dashboard/layout.tsx": { default: Shell },
        "reports/layout.tsx": componentLoader("reports-shell"),
      },
    });

    const byPath = new Map(routes.map((route) => [route.path, route]));
    assert.equal(byPath.get("dashboard").element.type, Shell);
    assert.equal(byPath.get("reports").element.type, React.Suspense);
  });

  test("reuses one lazy component per layout within a generator", () => {
    const generate = createRouteGenerator(
      { "dashboard/page.tsx": componentLoader("dashboard") },
      { "dashboard/layout.tsx": componentLoader("shell") },
      {},
      undefined,
      { lazyLayouts: true },
    );

    assert.equal(lazyOf(generate()[0].element), lazyOf(generate()[0].element));
  });

  test("reports a lazy layout that resolves without a default export", async () => {
    const { tree, routes } = createLazyLayoutRoutes({
      pages: { "dashboard/page.tsx": componentLoader("dashboard") },
      layouts: { "dashboard/layout.tsx": async () => ({ metadata: "no default" }) },
    });

    // The route is still generated; the module only exists once its chunk
    // loads, so the check has to be deferred to the loader.
    assert.equal(routes[0].element.type, React.Suspense);
    await assert.rejects(
      () => tree.children.get("dashboard").lazyLayout(),
      {
        message: [
          'Route layout "dashboard/layout.tsx" does not default-export a React component.',
          "Add `export default` to the file, for example: `export default function Layout({ children }) { ... }`.",
        ].join("\n"),
      },
    );
  });

  test("names the file when a lazy layout glob is read without lazyLayouts", () => {
    // A non-eager glob yields `() => import("...")` loaders; without the flag
    // they are read as eager components, and rendering one used to surface only
    // React's nameless "[object Promise]" child error.
    const tree = buildRouteTree(
      { "dashboard/page.tsx": componentLoader("dashboard") },
      { "dashboard/layout.tsx": async () => ({ default: component("shell") }) },
      {},
    );

    const Layout = tree.children.get("dashboard").layout;
    assert.throws(
      () => renderToStaticMarkup(React.createElement(Layout)),
      {
        message: [
          'Route layout "dashboard/layout.tsx" rendered a Promise instead of a component.',
          "Layouts are read as eager components unless told otherwise: pair a non-eager `import.meta.glob` of loaders with `{ lazyLayouts: true }`, or import the layout eagerly (`{ eager: true }`) to keep it a component.",
        ].join("\n"),
      },
    );
  });

  test("reports an eager component layout passed to lazyLayouts as a loader", async () => {
    // `{ eager: true, import: "default" }` yields the component itself, which
    // `lazyLayouts: true` reads as a loader. Resolving it used to render an
    // empty element in silence because a React element matched `$$typeof`.
    const tree = buildRouteTree(
      { "dashboard/page.tsx": componentLoader("dashboard") },
      { "dashboard/layout.tsx": component("shell") },
      {},
      undefined,
      { lazyLayouts: true },
    );

    await assert.rejects(
      () => tree.children.get("dashboard").lazyLayout(),
      {
        message: [
          'Route layout "dashboard/layout.tsx" does not default-export a React component.',
          "Add `export default` to the file, for example: `export default function Layout({ children }) { ... }`.",
        ].join("\n"),
      },
    );
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

    const LayoutNode = tree.children.get("about").layout;
    assert.equal(typeof LayoutNode, "function");
    // A bare-function eager layout is guarded against a misread lazy glob, but
    // a real `import: "default"` component still renders unchanged instead of
    // being reported as a missing default export.
    assert.equal(
      renderToStaticMarkup(React.createElement(LayoutNode)),
      "<div>layout</div>",
    );
    assert.deepEqual(await tree.children.get("about").page(), { default: About });
  });
});

describe("typed navigation helpers", () => {
  test("fills dynamic parameters into a route pattern", () => {
    assert.equal(href("/users/:id", { id: "42" }), "/users/42");
    assert.equal(
      href("/compare/:from/:to", { from: "paris", to: "berlin" }),
      "/compare/paris/berlin",
    );
    assert.equal(href("/typed-routes"), "/typed-routes");
    assert.equal(href("/"), "/");
  });

  test("maps a named catch-all onto the splat when the generator knows its name", () => {
    // The public pattern is "/blog/*"; only the metadata the plugin generates
    // reveals that the folder is "[...slug]", so the friendly key needs it.
    const slug = { catchAll: { name: "slug", optional: false } };
    const files = { catchAll: { name: "files", optional: false } };
    assert.equal(href("/blog/*", { slug: "guide/api" }, slug), "/blog/guide/api");
    assert.equal(href("/*", { files: "a/b" }, files), "/a/b");
    // Without metadata the raw helper addresses the splat only as "*".
    assert.equal(href("/blog/*", { "*": "guide/api" }), "/blog/guide/api");
  });

  test("resolves an empty optional catch-all to the base path", () => {
    const segments = { catchAll: { name: "segments", optional: true } };
    const slug = { catchAll: { name: "slug", optional: true } };
    assert.equal(href("/docs/*", { segments: "a/b" }, segments), "/docs/a/b");
    assert.equal(href("/docs/*", { segments: "" }, segments), "/docs");
    assert.equal(href("/docs/*", {}, segments), "/docs");
    assert.equal(href("/*", { slug: "" }, slug), "/");
  });

  test("accepts the segment array useCatchAll returns", () => {
    const slug = { catchAll: { name: "slug", optional: false } };
    const optionalSlug = { catchAll: { name: "slug", optional: true } };
    const segments = { catchAll: { name: "segments", optional: true } };
    assert.equal(href("/blog/*", { slug: ["guide", "api"] }, slug), "/blog/guide/api");
    assert.equal(href("/docs/*", { segments: ["a", "b"] }, segments), "/docs/a/b");
    // `useCatchAll()` reports [] on the base path of an optional catch-all, which
    // joins to "" and resolves back to that base path.
    assert.equal(href("/docs/*", { segments: [] }, segments), "/docs");
    assert.equal(href("/*", { slug: [] }, optionalSlug), "/");
  });

  test("drops empty segments from a catch-all value, like useCatchAll", () => {
    // A trailing slash, a leading slash, a doubled slash, or a blank array entry
    // must not inject a "//" into the path, so href filters empty segments the
    // same way useCatchAll does when reading.
    const slug = { catchAll: { name: "slug", optional: false } };
    const segments = { catchAll: { name: "segments", optional: true } };
    assert.equal(href("/blog/*", { slug: "/a/b/" }, slug), "/blog/a/b");
    assert.equal(href("/blog/*", { slug: ["a", "", "b"] }, slug), "/blog/a/b");
    assert.equal(href("/blog/*", { slug: "a//b" }, slug), "/blog/a/b");
    // Dropping empties still leaves an all-empty value resolving to the base.
    assert.equal(href("/docs/*", { segments: "/" }, segments), "/docs");
    assert.equal(href("/docs/*", { segments: ["", ""] }, segments), "/docs");
  });

  test("percent-encodes each substituted path segment itself, not via generatePath", () => {
    // generatePath encodes in React Router v7 but not v6, and href no longer
    // calls it, so every value is encoded here once and the same on both.
    const slug = { catchAll: { name: "slug", optional: false } };
    assert.equal(href("/users/:id", { id: "a/b?x#y" }), "/users/a%2Fb%3Fx%23y");
    assert.equal(href("/blog/*", { slug: ["a b", "c?d"] }, slug), "/blog/a%20b/c%3Fd");
    // A string catch-all keeps `/` as its separator while encoding each part.
    assert.equal(href("/blog/*", { slug: "a b/c?d" }, slug), "/blog/a%20b/c%3Fd");
    // Ordinary values are unaffected, so existing routes read back the same.
    assert.equal(href("/blog/*", { slug: "guide/api" }, slug), "/blog/guide/api");
    assert.equal(href("/users/:id", { id: "42" }), "/users/42");
  });

  test("percent-encodes Unicode parameter values", () => {
    // A `:name` value and each catch-all segment go through encodeURIComponent,
    // so a multi-byte value is escaped identically on React Router v6 and v7
    // (`href` never calls `generatePath`, whose encoding differs between them).
    const slug = { catchAll: { name: "slug", optional: false } };
    assert.equal(href("/users/:id", { id: "café" }), "/users/caf%C3%A9");
    assert.equal(href("/u/:id", { id: "👍" }), "/u/%F0%9F%91%8D");
    // A catch-all keeps `/` as its separator while encoding each segment.
    assert.equal(href("/blog/*", { slug: "日本/語" }, slug), "/blog/%E6%97%A5%E6%9C%AC/%E8%AA%9E");
    // The encoded value is a valid single segment, so it reads back unchanged.
    assert.equal(href("/users/:id", { id: "café" }), "/users/caf%C3%A9");
  });

  test("rejects a value that resolves as a dot-segment", () => {
    // encodeURIComponent leaves "." and ".." verbatim and a browser / React
    // Router still resolves them out of the path, so href refuses them rather
    // than encoding a value that would turn "/users/.." into "/".
    assert.throws(
      () => href("/users/:id", { id: ".." }),
      { message: /cannot be "\.\.":/ },
    );
    assert.throws(
      () => href("/users/:id", { id: "." }),
      { message: /cannot be "\.":/ },
    );
    // A catch-all is validated per segment, as an array or a split string.
    const slug = { catchAll: { name: "slug", optional: false } };
    assert.throws(
      () => href("/blog/*", { slug: ["..", "x"] }, slug),
      { message: /cannot be "\.\.":/ },
    );
    assert.throws(
      () => href("/blog/*", { slug: "a/.." }, slug),
      { message: /cannot be "\.\.":/ },
    );
    // Only an exact "." / ".." segment is a dot-segment; a longer value, and a
    // pre-encoded one that encodeURIComponent escapes to "%252e", stay safe.
    assert.equal(href("/users/:id", { id: "..." }), "/users/...");
    assert.equal(href("/users/:id", { id: "a.b" }), "/users/a.b");
    assert.equal(href("/users/:id", { id: "%2e%2e" }), "/users/%252e%252e");
  });

  test("reports a parameter the pattern cannot consume", () => {
    assert.throws(
      () => href("/users/:id", { userId: "42" }),
      {
        message: 'Route "/users/:id" has no "userId" parameter. Expected: "id".',
      },
    );
    assert.throws(
      () => href("/about", { id: "1" }),
      {
        message: 'Route "/about" has no "id" parameter. This route takes no parameters.',
      },
    );
  });

  test("rejects a catch-all key the route does not declare", () => {
    // The generator knows the folder is "[...slug]", so "other" must fail rather
    // than be routed onto the splat — this is the central correctness fix.
    const slug = { catchAll: { name: "slug", optional: false } };
    assert.throws(
      () => href("/blog/*", { other: "guide/api" }, slug),
      {
        message:
          'Route "/blog/*" has no "other" parameter. Expected: "slug". ' +
          'Pass the value under its declared name "slug" (or React Router\'s "*").',
      },
    );
    // A bare href carries no metadata, so it cannot validate "slug" and rejects
    // it too; only React Router's "*" fills the splat there.
    assert.throws(
      () => href("/blog/*", { slug: "guide/api" }),
      {
        message:
          'Route "/blog/*" has no "slug" parameter. Expected: "*". ' +
          'Address the splat with "*", or import href/Link from ' +
          '"next-vite-router/routes" so a catch-all is validated by its folder name.',
      },
    );
    // One catch-all value only, even when named two valid ways at once.
    assert.throws(
      () => href("/blog/*", { slug: "a", "*": "b" }, slug),
      {
        message: 'Route "/blog/*" takes one catch-all value, but 2 params were supplied ("slug", "*").',
      },
    );
  });

  test("rejects a missing or empty value for a required catch-all", () => {
    // "[...slug]" never matches "/blog" on its own, so resolving to the base path
    // would render a broken link; report it like a missing required param.
    const slug = { catchAll: { name: "slug", optional: false } };
    assert.throws(
      () => href("/blog/*", {}, slug),
      { message: 'Route "/blog/*" is missing the required "slug" catch-all param.' },
    );
    assert.throws(
      () => href("/blog/*", { slug: [] }, slug),
      { message: /requires a non-empty value for its "slug" catch-all param/ },
    );
    assert.throws(
      () => href("/blog/*", { slug: "" }, slug),
      { message: /requires a non-empty value for its "slug" catch-all param/ },
    );
  });

  test("rejects a segment array for a single-segment param", () => {
    // Only a catch-all spans several segments; an array on `[id]` is a mistake,
    // and joining it would silently build a path the route cannot match.
    assert.throws(
      () => href("/users/:id", { id: ["1", "2"] }),
      {
        message:
          'Route "/users/:id" expects a string for its ":id" param; only a catch-all value accepts an array of segments.',
      },
    );
  });

  test("reports a missing required parameter with its route", () => {
    assert.throws(
      () => href("/users/:id"),
      { message: 'Route "/users/:id" is missing the required ":id" param.' },
    );
    assert.throws(
      () => href("/users/:id", { id: undefined }),
      { message: 'Route "/users/:id" is missing the required ":id" param.' },
    );
  });

  test("rejects an empty value for a required parameter", () => {
    // An empty `:name` would encode to "" and collapse its segment, so
    // "/users/:id" would resolve to "/users/" — a different route — without an
    // error. Report it like a missing value instead of building that link.
    assert.throws(
      () => href("/users/:id", { id: "" }),
      { message: /requires a non-empty value for its ":id" param/ },
    );
    assert.throws(
      () => href("/compare/:from/:to", { from: "paris", to: "" }),
      { message: /requires a non-empty value for its ":to" param/ },
    );
  });

  test("rejects a pattern that is not root-relative", () => {
    assert.throws(
      () => href("users/:id", { id: "42" }),
      {
        message:
          'Route pattern "users/:id" must be root-relative, like the generated RoutePath values ("/users/:id").',
      },
    );
  });

  const renderLink = (props, ...children) => renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/"] },
      React.createElement(Link, props, ...children),
    ),
  );

  test("Link renders the resolved href and forwards other link props", () => {
    const markup = renderLink(
      {
        href: "/users/:id",
        params: { id: "42" },
        className: "user-link",
        title: "Open the profile",
      },
      "Profile",
    );

    assert.match(markup, /href="\/users\/42"/);
    assert.match(markup, /class="user-link"/);
    assert.match(markup, /title="Open the profile"/);
    assert.match(markup, /<a[^>]*>Profile<\/a>/);
  });

  test("Link accepts a catch-all segment array through its generated metadata", () => {
    // The plugin-bound Link (createTypedLink) knows the folder name; the value
    // `useCatchAll()` returns can be handed straight back to it.
    const BlogLink = createTypedLink({
      "/blog/*": { catchAll: { name: "slug", optional: false } },
    });
    const markup = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        React.createElement(BlogLink, { href: "/blog/*", params: { slug: ["guide", "api"] } }, "Docs"),
      ),
    );
    assert.match(markup, /href="\/blog\/guide\/api"/);
  });

  test("the raw Link fills a catch-all only through the splat, not a guessed name", () => {
    // `Link` imported directly from the package carries no metadata, so a friendly
    // name cannot be validated and is rejected exactly like the raw `href`.
    assert.throws(
      () => renderLink({ href: "/blog/*", params: { slug: "guide/api" } }, "Docs"),
      { message: /Route "\/blog\/\*" has no "slug" parameter/ },
    );
    // "*" still addresses the splat, and a misspelled key is rejected.
    assert.match(
      renderLink({ href: "/blog/*", params: { "*": "guide/api" } }, "Docs"),
      /href="\/blog\/guide\/api"/,
    );
    assert.throws(
      () => renderLink({ href: "/blog/*", params: { other: "guide/api" } }, "Docs"),
      { message: /has no "other" parameter/ },
    );
  });

  test("Link accepts a pattern without parameters as-is", () => {
    assert.match(renderLink({ href: "/about" }, "About"), /href="\/about"/);
  });

  test("Link leaves an address with nothing to substitute alone", () => {
    // generatePath() collapses the "//" of an absolute URL, so a `href` without
    // a token is passed to React Router untouched instead of being rewritten.
    assert.match(
      renderLink({ href: "https://example.com/a/b" }, "Docs"),
      /href="https:\/\/example\.com\/a\/b"/,
    );
  });

  test("Link fails with the route instead of rendering an empty anchor", () => {
    assert.throws(
      () => renderLink({ href: "/users/:id" }, "Profile"),
      { message: 'Route "/users/:id" is missing the required ":id" param.' },
    );
  });

  test("Link names the prop it wants when handed React Router's to", () => {
    // Upgrading apps used to get React Router's `Link` from the virtual module,
    // so a `to` here has to be reported instead of rendering a dead link.
    assert.throws(
      () => renderLink({ to: "/users" }, "Users"),
      /Link takes a route pattern in `href`/,
    );
  });
});