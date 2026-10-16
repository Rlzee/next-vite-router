import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { matchRoutes } from "react-router-dom";
import {
  buildRouteTree,
  assertNoDuplicateRoutes,
  clearLazyCache,
  configureRouter,
  resetRouterConfig,
  treeToRoutes,
} from "../dist/index.js";
import { extractRoutePath } from "../dist/index.js";

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

beforeEach(() => {
  // Reset every module-level singleton so state cannot leak between tests:
  // the router configuration and the lazy component cache (previously
  // unreset, so a shared route key reused a stale React.lazy component from
  // an earlier test).
  resetRouterConfig();
  clearLazyCache();
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
