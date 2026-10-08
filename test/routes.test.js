import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import React from "react";
import {
  buildRouteTree,
  assertNoDuplicateRoutes,
  clearMiddlewares,
  configureRouter,
  registerMiddleware,
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
  clearMiddlewares();
  configureRouter({ enableLazyLoading: true, loadingFallback: undefined });
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

  test("rejects duplicate routes created by route groups", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "(a)/x/page.tsx",
        "(b)/x/page.tsx",
      ]),
      {
        message: [
          'Duplicate route "/x" detected:',
          "  (a)/x/page.tsx",
          "  (b)/x/page.tsx",
        ].join("\n"),
      },
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

  test("applies middleware to matching route paths", () => {
    const wrapped = Symbol("wrapped");
    registerMiddleware(/^\/users/, (element) =>
      React.createElement("section", { "data-test": wrapped }, element),
    );

    const routes = createRoutes({
      pages: { "users/[id]/page.tsx": loader("user") },
    });

    const element = routes[0].children[0].element;
    assert.equal(element.props["data-test"], wrapped);
  });

  test("resets global middleware regex state between routes", () => {
    const wrapped = Symbol("wrapped");
    registerMiddleware(/\/users/g, (element) =>
      React.createElement("section", { "data-test": wrapped }, element),
    );

    const routes = createRoutes({
      pages: {
        "users/first/page.tsx": loader("first"),
        "users/second/page.tsx": loader("second"),
      },
    });

    assert.equal(routes[0].children[0].element.props["data-test"], wrapped);
    assert.equal(routes[0].children[1].element.props["data-test"], wrapped);
  });

  test("keeps colliding dynamic parameter names as distinct route definitions", () => {
    const routes = createRoutes({
      pages: {
        "users/[id]/page.tsx": loader("id"),
        "users/[slug]/page.tsx": loader("slug"),
      },
    });

    assert.deepEqual(routeShape(routes), [{
      path: "users",
      children: [
        { path: ":id", children: undefined },
        { path: ":slug", children: undefined },
      ],
    }]);
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

  test("creates lazy route elements with and without the loading fallback", () => {
    let routes = createRoutes({
      pages: { "lazy/page.tsx": loader("lazy") },
    });
    assert.equal(routes[0].element.type, React.Suspense);
    assert.equal(typeof routes[0].element.props.fallback.type, "function");

    configureRouter({ enableLazyLoading: false });
    routes = createRoutes({
      pages: { "direct/page.tsx": loader("direct") },
    });
    assert.equal(routes[0].element.type, React.Suspense);
    assert.equal(routes[0].element.props.fallback, null);
  });
});
