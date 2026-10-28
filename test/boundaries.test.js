import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useRoutes } from "react-router-dom";
import {
  buildRouteTree,
  configureRouter,
  createLazyCache,
  resetRouterConfig,
  treeToRoutes,
} from "../dist/index.js";
// The boundary components are engine internals reached through the same build
// entry the generated routes module resolves by path (never a package specifier).
import { RouteErrorBoundary, SegmentBoundary } from "../dist/plugin-runtime.js";

const loader = (name) => async () => ({ default: name });
// An eager `import.meta.glob` yields the module namespace, whose `default` is
// the component - the shape `loading.tsx` / `error.tsx` are always read in.
const eager = (name) => ({ default: name });
const component = (name) => function Component() {
  return React.createElement("div", null, name);
};

/** Is this element a folder boundary (rather than a page/layout element)? */
const isBoundary = (element) => element?.type === SegmentBoundary;

function generate(records) {
  const tree = buildRouteTree(records);
  return { tree, routes: treeToRoutes(tree, true) };
}

beforeEach(() => {
  resetRouterConfig();
});

describe("converter: boundary placement", () => {
  test("leaves the tree untouched when nothing declares loading or error", () => {
    const { routes } = generate({
      pages: { "shop/page.tsx": loader("shop") },
    });

    // No marker set, so the wrapping pass never runs: the emitted element is the
    // lazy page itself, not a SegmentBoundary, exactly as before these files.
    assert.equal(routes[0].path, "shop");
    assert.ok(!isBoundary(routes[0].element));
  });

  test("wraps a folder's own page element in its loading boundary", () => {
    const ShopLoading = component("shop-loading");
    const { routes } = generate({
      pages: { "shop/page.tsx": loader("shop") },
      loadings: { "shop/loading.tsx": eager(ShopLoading) },
    });

    assert.equal(routes[0].path, "shop");
    assert.ok(isBoundary(routes[0].element));
    assert.equal(routes[0].element.props.loading, ShopLoading);
    assert.equal(routes[0].element.props.error, undefined);
  });

  test("a folder's boundary wraps its page index and a child page below it", () => {
    const ShopError = component("shop-error");
    const { routes } = generate({
      pages: {
        "shop/page.tsx": loader("shop"),
        "shop/cart/page.tsx": loader("cart"),
      },
      errors: { "shop/error.tsx": eager(ShopError) },
    });

    // `shop` becomes `{ path: "shop", children: [index, cart] }`. Both the page
    // index and the child `cart` render in shop's outlet, so shop's boundary
    // guards each: a child error bubbles to the enclosing folder's `error.tsx`.
    const shopRoute = routes.find((route) => route.path === "shop");
    const index = shopRoute.children.find((route) => route.index);
    const cart = shopRoute.children.find((route) => route.path === "cart");
    assert.ok(isBoundary(index.element), "the folder's index is guarded");
    assert.ok(isBoundary(cart.element), "a child page is guarded by the parent boundary");
    assert.equal(index.element.props.error, ShopError);
    assert.equal(cart.element.props.error, ShopError);
  });

  test("a child folder's layout is guarded by the ancestor, not by its own boundary", () => {
    const ShopError = component("shop-error");
    const ShopLayout = component("shop-layout");
    const { routes } = generate({
      pages: {
        "shop/page.tsx": loader("shop"),
        "shop/cart/page.tsx": loader("cart"),
      },
      layouts: { "shop/cart/layout.tsx": eager(ShopLayout) },
      errors: { "shop/error.tsx": eager(ShopError) },
    });

    // Next.js stacks `layout > error`, and the parent's `error.tsx` catches a
    // child layout's failure. `cart`'s route element is its layout, wrapped by
    // `shop`'s boundary (it renders in shop's outlet); `cart`'s own content (its
    // index) is not re-wrapped because `cart` declares no boundary of its own.
    const shopRoute = routes.find((route) => route.path === "shop");
    const cartRoute = shopRoute.children.find((route) => route.path === "cart");
    assert.ok(isBoundary(cartRoute.element), "shop guards the cart layout");
    assert.equal(cartRoute.element.props.error, ShopError);
    const cartIndex = cartRoute.children.find((route) => route.index);
    assert.ok(!isBoundary(cartIndex.element), "cart has no boundary of its own");
  });

  test("wraps page content inside a folder layout, below it", () => {
    const ShopError = component("shop-error");
    const ShopLayout = component("shop-layout");
    const { routes } = generate({
      pages: { "shop/page.tsx": loader("shop") },
      layouts: { "shop/layout.tsx": eager(ShopLayout) },
      errors: { "shop/error.tsx": eager(ShopError) },
    });

    // With a layout the folder's outer route carries the layout element, and the
    // boundary wraps the index below it - so the layout renders OUTSIDE its own
    // error boundary.
    const shopRoute = routes.find((route) => route.path === "shop");
    assert.ok(!isBoundary(shopRoute.element), "the layout element is not itself wrapped in the boundary");
    const index = shopRoute.children.find((route) => route.index);
    assert.ok(isBoundary(index.element));
    assert.equal(index.element.props.error, ShopError);
  });

  test("a page under a route group carries the folder boundary", () => {
    const ShopLoading = component("shop-loading");
    const { routes } = generate({
      pages: { "(marketing)/shop/page.tsx": loader("shop") },
      loadings: { "(marketing)/shop/loading.tsx": eager(ShopLoading) },
    });

    // The group owns no URL segment, so `shop` is emitted at the enclosing level;
    // it is a leaf page, and its own `loading.tsx` wraps that page.
    const shop = routes.find((route) => route.path === "shop");
    assert.ok(shop, "the group is dropped from the emitted tree");
    assert.ok(!routes.some((route) => route.path === "(marketing)" || route.path === undefined && route.children));
    assert.ok(isBoundary(shop.element));
    assert.equal(shop.element.props.loading, ShopLoading);
  });
});

describe("rendering: loading placeholder", () => {
  const pendingPage = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    // A lazy component that suspends and never settles in this render pass, so
    // the nearest fallback paints.
    return { default: React.lazy(() => promise) , resolve };
  };

  test("loading.tsx replaces the configured fallback for that folder", () => {
    const ShopLoading = component("SHOP-LOADING");
    const suspending = pendingPage();
    const { routes } = generate({
      pages: { "shop/page.tsx": async () => suspending.default },
      loadings: { "shop/loading.tsx": eager(ShopLoading) },
    });
    configureRouter({ loadingFallback: component("GLOBAL-CONFIG-FALLBACK") });

    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/shop"] },
        React.createElement(() => useRoutes(routes)),
      ),
    );

    assert.ok(html.includes("SHOP-LOADING"), `expected the folder placeholder, got: ${html}`);
    assert.ok(!html.includes("GLOBAL-CONFIG-FALLBACK"), "loading.tsx wins over the global fallback");
  });

  test("the configured fallback still paints when a folder has no loading.tsx", () => {
    const suspending = pendingPage();
    const { routes } = generate({
      pages: {
        "shop/page.tsx": async () => suspending.default,
        "about/page.tsx": async () => pendingPage().default,
      },
      loadings: { "shop/loading.tsx": eager(component("SHOP-LOADING")) },
    });
    configureRouter({ loadingFallback: component("GLOBAL-CONFIG-FALLBACK") });

    const shopHtml = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ["/shop"] },
        React.createElement(() => useRoutes(routes))),
    );
    const aboutHtml = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ["/about"] },
        React.createElement(() => useRoutes(routes))),
    );

    assert.ok(shopHtml.includes("SHOP-LOADING"));
    assert.ok(!aboutHtml.includes("SHOP-LOADING"));
    assert.ok(aboutHtml.includes("GLOBAL-CONFIG-FALLBACK"), "a folder with no loading.tsx keeps the global fallback");
  });
});

describe("RouteErrorBoundary lifecycle", () => {
  // React does not run the catch of a class boundary under a static render, so
  // the two behaviors it owns - deriving the fallback and resetting on
  // navigation - are pinned directly on the lifecycle methods.
  const makeBoundary = (error) =>
    new RouteErrorBoundary({ error, resetKey: "/a", children: null });

  test("derives the thrown error into state", () => {
    const thrown = new Error("boom");
    assert.deepEqual(RouteErrorBoundary.getDerivedStateFromError(thrown), { error: thrown });
  });

  test("clears a caught error when the pathname changes", () => {
    const Fallback = component("err");
    const boundary = makeBoundary(Fallback);
    boundary.state = { error: new Error("boom") };
    // A stub setState records the reset a real mount would apply.
    let reset = false;
    boundary.setState = () => { reset = true; };

    boundary.componentDidUpdate({ resetKey: "/a" });
    assert.equal(reset, false, "same pathname keeps the error on screen");
    boundary.componentDidUpdate({ resetKey: "/b" });
    assert.equal(reset, true, "a new pathname clears it, so another page of the folder is not stuck on the error");
  });

  test("renders children while healthy and the fallback once failed", () => {
    const Fallback = component("SCREEN");
    const child = React.createElement("i", null, "ok");
    const healthy = new RouteErrorBoundary({ error: Fallback, resetKey: "/a", children: child });
    assert.equal(healthy.render(), child, "a healthy boundary renders its subtree untouched");

    const failed = makeBoundary(Fallback);
    failed.state = { error: new Error("boom") };
    const element = failed.render();
    assert.equal(element.type, Fallback);
    assert.equal(element.props.error.message, "boom");
    assert.equal(typeof element.props.reset, "function");
  });
});

describe("buildRouteTree: loading/error validation", () => {
  test("rejects two loading files that claim one route", () => {
    assert.throws(
      () => buildRouteTree({
        pages: { "shop/page.tsx": loader("shop") },
        loadings: {
          "(a)/shop/loading.tsx": eager(component("one")),
          "(b)/shop/loading.tsx": eager(component("two")),
        },
      }),
      /Duplicate route "\/shop" detected/,
    );
  });

  test("refuses a lazily supplied loading file", () => {
    assert.throws(
      () => buildRouteTree({
        pages: { "shop/page.tsx": loader("shop") },
        loadings: { "shop/loading.tsx": async () => ({ default: component("x") }) },
      }),
      /loading "shop\/loading.tsx" must come from an eager glob/,
    );
  });

  test("refuses a loading file without a default-exported component", () => {
    assert.throws(
      () => buildRouteTree({
        pages: { "shop/page.tsx": loader("shop") },
        loadings: { "shop/loading.tsx": { notAComponent: true } },
      }),
      /Route loading "shop\/loading.tsx" does not default-export a React component/,
    );
  });
});
