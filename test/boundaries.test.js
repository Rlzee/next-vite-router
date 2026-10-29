import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, useRoutes } from "react-router-dom";
import {
  buildRouteTree,
  clearLazyCache,
  configureRouter,
  createLazyCache,
  createLazyElement,
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

/**
 * The pathless boundary route a folder emits in front of its content. When the
 * folder declares `loading.tsx` or `error.tsx`, its children become
 * `[{ element: <SegmentBoundary><Outlet/></SegmentBoundary>, children: [...] }]`,
 * so a boundary at every depth wraps everything the folder renders in its
 * outlet. Returns the boundary route when present, else `undefined`.
 */
const boundaryOf = (route) => route?.children?.find((child) => isBoundary(child.element));

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

    // No boundary declared anywhere: the emitted element is the lazy page
    // itself, not a SegmentBoundary, and no extra pathless route shows up
    // exactly as before these files existed.
    assert.equal(routes[0].path, "shop");
    assert.ok(!isBoundary(routes[0].element));
    assert.ok(!routes[0].children, "a leaf without a boundary stays a leaf");
  });

  test("wraps a folder's own page element in its loading boundary", () => {
    const ShopLoading = component("shop-loading");
    const { routes } = generate({
      pages: { "shop/page.tsx": loader("shop") },
      loadings: { "shop/loading.tsx": eager(ShopLoading) },
    });

    // `shop` becomes `{ path, children: [{ element: <Seg loading><Outlet/></Seg>,
    // children: [{ index: true, element: page }] }] }`: the pathless boundary
    // route sits between the folder's URL and everything it emits there, so
    // the boundary reaches descendants at any depth (not just a leaf's element).
    assert.equal(routes[0].path, "shop");
    const boundary = boundaryOf(routes[0]);
    assert.ok(boundary, "a pathless boundary route is inserted");
    assert.equal(boundary.element.props.loading, ShopLoading);
    assert.equal(boundary.element.props.error, undefined);
    const index = boundary.children.find((route) => route.index);
    assert.ok(index, "the page lives inside the boundary as an index");
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

    // `shop` emits `{ path, children: [boundary] }`; inside the boundary sit
    // the page index AND the `cart` child route. A child error therefore
    // bubbles to the enclosing folder's `error.tsx`, exactly as Next.js
    // specifies.
    const shopRoute = routes.find((route) => route.path === "shop");
    const boundary = boundaryOf(shopRoute);
    assert.ok(boundary, "shop's boundary wraps its whole subtree");
    assert.equal(boundary.element.props.error, ShopError);
    const index = boundary.children.find((route) => route.index);
    const cart = boundary.children.find((route) => route.path === "cart");
    assert.ok(index, "the folder's index renders inside the boundary");
    assert.ok(cart, "a child page renders inside the boundary at any depth");
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
    // child layout's failure. `cart`'s route element is its layout; because
    // it lives inside `shop`'s boundary route, a throw during the cart
    // layout's render is caught by shop's error, never by cart's (which
    // declares none).
    const shopRoute = routes.find((route) => route.path === "shop");
    const shopBoundary = boundaryOf(shopRoute);
    assert.ok(shopBoundary, "shop guards its whole subtree");
    const cartRoute = shopBoundary.children.find((route) => route.path === "cart");
    assert.ok(cartRoute, "cart lives inside shop's boundary");
    assert.ok(!isBoundary(cartRoute.element), "cart has no boundary of its own");
    const cartIndex = cartRoute.children.find((route) => route.index);
    assert.ok(cartIndex, "cart's index renders through cart's layout outlet");
    assert.ok(!isBoundary(cartIndex.element), "cart declares no loading/error");
  });

  test("wraps page content inside a folder layout, below it", () => {
    const ShopError = component("shop-error");
    const ShopLayout = component("shop-layout");
    const { routes } = generate({
      pages: { "shop/page.tsx": loader("shop") },
      layouts: { "shop/layout.tsx": eager(ShopLayout) },
      errors: { "shop/error.tsx": eager(ShopError) },
    });

    // With a layout the folder's outer route keeps the layout element, and the
    // boundary is inserted one level below it, so a throw inside the layout
    // is caught by the *parent's* `error.tsx` (or nothing), never by this
    // folder's own.
    const shopRoute = routes.find((route) => route.path === "shop");
    assert.ok(!isBoundary(shopRoute.element), "the layout element is not itself the boundary");
    const boundary = boundaryOf(shopRoute);
    assert.ok(boundary, "the boundary sits below the layout");
    assert.equal(boundary.element.props.error, ShopError);
  });

  test("a page under a route group carries the folder boundary", () => {
    const ShopLoading = component("shop-loading");
    const { routes } = generate({
      pages: { "(marketing)/shop/page.tsx": loader("shop") },
      loadings: { "(marketing)/shop/loading.tsx": eager(ShopLoading) },
    });

    // The group owns no URL segment, so `shop` is emitted at the enclosing
    // level; the group has no boundary of its own, so it stays transparent and
    // `shop`'s loading wraps everything `shop` renders.
    const shop = routes.find((route) => route.path === "shop");
    assert.ok(shop, "the group is dropped from the emitted tree");
    assert.ok(!routes.some((route) => route.path === "(marketing)"));
    const boundary = boundaryOf(shop);
    assert.ok(boundary, "shop's loading guards its subtree");
    assert.equal(boundary.element.props.loading, ShopLoading);
  });

  test("a route group's own loading/error guards every page beneath it", () => {
    const GrpLoading = component("grp-loading");
    const GrpError = component("grp-error");
    const { routes } = generate({
      pages: {
        "sec/(grp)/gpage/page.tsx": loader("gpage"),
        "sec/(grp)/other/deep/page.tsx": loader("deep"),
      },
      loadings: { "sec/(grp)/loading.tsx": eager(GrpLoading) },
      errors: { "sec/(grp)/error.tsx": eager(GrpError) },
    });

    // A group is a folder like any other for boundary purposes: the group's
    // own pathless route carries the element, so every descendant - a leaf
    // page directly under the group and a page two levels below it - renders
    // inside the same boundary.
    const sec = routes.find((route) => route.path === "sec");
    const grp = sec.children.find((route) => route.path === undefined);
    assert.ok(grp, "the group emits a pathless route");
    assert.ok(isBoundary(grp.element), "the group's pathless route carries the boundary");
    assert.equal(grp.element.props.loading, GrpLoading);
    assert.equal(grp.element.props.error, GrpError);
    const gpage = grp.children.find((route) => route.path === "gpage");
    const other = grp.children.find((route) => route.path === "other");
    assert.ok(gpage, "the direct page is inside the group boundary");
    assert.ok(other, "a deeper folder is inside the group boundary too");
  });

  test("a boundary in an intermediate folder reaches pages several levels below", () => {
    const DxError = component("dx-error");
    const { routes } = generate({
      pages: { "dx/y/z/page.tsx": loader("dx-yz") },
      errors: { "dx/error.tsx": eager(DxError) },
    });

    // The regression this pins: an error two levels below `dx/` used to reach
    // the nearest boundary above (the root's), taking the layout root with
    // it. With the boundary on a pathless route in front of `dx`'s whole
    // subtree, the `y/z/page` route renders inside `dx`'s error and the
    // layouts above survive.
    const dx = routes.find((route) => route.path === "dx");
    const boundary = boundaryOf(dx);
    assert.ok(boundary, "dx's boundary wraps its subtree");
    assert.equal(boundary.element.props.error, DxError);
    const y = boundary.children.find((route) => route.path === "y");
    assert.ok(y, "the intermediate y lives inside dx's boundary");
    const z = y.children.find((route) => route.path === "z");
    assert.ok(z, "and so does the deeper z, with no layout between them");
  });

  test("a root boundary renders inside the root layout, not above it", () => {
    const RootError = component("root-error");
    const RootLayout = component("root-layout");
    const { routes } = generate({
      pages: { "about/page.tsx": loader("about") },
      layouts: { "layout.tsx": eager(RootLayout) },
      errors: { "error.tsx": eager(RootError) },
    });

    // Next.js puts a root `error.tsx` inside the root layout, so the layout
    // keeps painting when a page throws. The old pass wrapped the root layout
    // route itself, which hid the layout on a root-level failure.
    const root = routes[0];
    assert.equal(root.path, "/");
    assert.ok(!isBoundary(root.element), "the root layout is not itself wrapped in the boundary");
    const boundary = boundaryOf(root);
    assert.ok(boundary, "the boundary sits inside the root layout's outlet");
    assert.equal(boundary.element.props.error, RootError);
    const about = boundary.children.find((route) => route.path === "about");
    assert.ok(about, "every route below the root lives inside the root boundary");
  });
});

describe("full tree: multi-level integration", () => {
  /**
   * One tree covering every scenario from the boundary-depth bug report:
   * a root layout with a root `error.tsx`, `dx/error.tsx` guarding a page
   * two levels below with no layout in between, a route group carrying its
   * own `loading.tsx` + `error.tsx`, and a `not-found.tsx` that must render
   * inside the boundaries. The shape assertions walk the whole nested tree
   * in one shot; the render assertions below prove every pathless boundary
   * route actually forwards through its Outlet.
   */
  const buildFullTree = () => {
    // A real layout must render an `<Outlet/>` for its children to paint; the
    // test keeps the shape compact so the render assertions below can see the
    // boundary route forward through every level of the chain.
    const RootLayout = () =>
      React.createElement("div", null, "ROOT-LAYOUT[", React.createElement(Outlet), "]ROOT-LAYOUT");
    const RootError = component("ROOT-ERROR");
    const DxError = component("DX-ERROR");
    const GrpLoading = component("GRP-LOADING");
    const GrpError = component("GRP-ERROR");
    const NotFound = component("ROOT-NOT-FOUND");
    const { tree, routes } = generate({
      pages: {
        "home/page.tsx": loader(component("HOME")),
        "dx/y/z/page.tsx": loader(component("DX-YZ")),
        "sec/(grp)/gpage/page.tsx": loader(component("GRP-PAGE")),
      },
      layouts: { "layout.tsx": eager(RootLayout) },
      errors: {
        "error.tsx": eager(RootError),
        "dx/error.tsx": eager(DxError),
        "sec/(grp)/error.tsx": eager(GrpError),
      },
      loadings: { "sec/(grp)/loading.tsx": eager(GrpLoading) },
      notFounds: { "not-found.tsx": loader(NotFound) },
    });
    return { tree, routes, RootLayout, RootError, DxError, GrpLoading, GrpError, NotFound };
  };

  /**
   * Render `routes` at `url` through `useRoutes` inside a `MemoryRouter`.
   * Pages arrive via `React.lazy`, so the first pass only kicks the loaders
   * off and paints the fallback; after a microtask the second pass paints the
   * resolved component, exactly as a browser repaints after a chunk arrives.
   */
  const renderAt = async (routes, url) => {
    const App = () => useRoutes(routes);
    const tree = React.createElement(
      MemoryRouter,
      { initialEntries: [url] },
      React.createElement(App),
    );
    renderToStaticMarkup(tree);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return renderToStaticMarkup(tree);
  };

  test("the emitted tree nests every boundary the report describes", () => {
    const {
      routes, RootLayout, RootError, DxError, GrpLoading, GrpError,
    } = buildFullTree();

    // Root layout stays outside its own boundary, and the boundary wraps the
    // whole subtree - the shape the old post-pass got wrong by hiding the
    // root layout on a deep error.
    const root = routes[0];
    assert.equal(root.path, "/");
    assert.ok(!isBoundary(root.element), "the root layout is not itself wrapped");
    const rootBoundary = boundaryOf(root);
    assert.equal(rootBoundary.element.props.error, RootError);

    // The deep page case: `dx/error.tsx` must reach `dx/y/z/page.tsx` even
    // when neither `dx/y` nor `dx/y/z` owns a `layout.tsx` or boundary file.
    // The intermediate folders contribute no element of their own, so the
    // only shape that gets this right is the boundary pathless route in
    // front of every route `dx` emits.
    const dx = rootBoundary.children.find((route) => route.path === "dx");
    const dxBoundary = boundaryOf(dx);
    assert.equal(dxBoundary.element.props.error, DxError);
    const y = dxBoundary.children.find((route) => route.path === "y");
    const z = y.children.find((route) => route.path === "z");
    assert.ok(z, "z lives inside dx's boundary at two levels deep");

    // The group case: `(grp)` carries its own loading + error on the group's
    // existing pathless route, so `gpage` renders inside the boundary without
    // the group needing a layout of its own.
    const sec = rootBoundary.children.find((route) => route.path === "sec");
    const grp = sec.children.find((route) => route.path === undefined);
    assert.ok(isBoundary(grp.element), "the group's pathless route carries the boundary");
    assert.equal(grp.element.props.loading, GrpLoading);
    assert.equal(grp.element.props.error, GrpError);
    const gpage = grp.children.find((route) => route.path === "gpage");
    assert.ok(gpage, "the grouped page lives inside the group boundary");

    // The root's `not-found` is a `*` route inside the root's boundary, so it
    // paints inside the layout (Next.js contract), not beside or above it.
    const notFound = rootBoundary.children.find((route) => route.path === "*");
    assert.ok(notFound, "the not-found splat renders inside the root boundary");
  });

  test("/dx/y/z paints through every boundary in its chain", async () => {
    const { routes } = buildFullTree();
    const html = await renderAt(routes, "/dx/y/z");
    assert.ok(html.includes("ROOT-LAYOUT"), "the root layout survives the whole chain");
    assert.ok(html.includes("DX-YZ"), `the deep page paints inside dx's boundary, got: ${html}`);
  });

  test("/sec/gpage paints through the group's own boundary", async () => {
    const { routes } = buildFullTree();
    const html = await renderAt(routes, "/sec/gpage");
    assert.ok(html.includes("ROOT-LAYOUT"));
    assert.ok(html.includes("GRP-PAGE"), `the grouped page paints inside the group boundary, got: ${html}`);
  });

  test("/home paints inside the root boundary (sibling to the folders)", async () => {
    const { routes } = buildFullTree();
    const html = await renderAt(routes, "/home");
    assert.ok(html.includes("ROOT-LAYOUT"));
    assert.ok(html.includes("HOME"), `a top-level page still lives inside the root boundary, got: ${html}`);
  });

  test("/nowhere paints the not-found inside the root boundary", async () => {
    const { routes } = buildFullTree();
    const html = await renderAt(routes, "/nowhere");
    assert.ok(html.includes("ROOT-LAYOUT"), "an unmatched URL keeps the layout");
    assert.ok(html.includes("ROOT-NOT-FOUND"), `the splat answers with the not-found, got: ${html}`);
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

  test("a folder's loading.tsx reaches a page several levels below", () => {
    const DxLoading = component("LOADING-DX");
    const suspending = pendingPage();
    const { routes } = generate({
      pages: { "dx/y/z/page.tsx": async () => suspending.default },
      loadings: { "dx/loading.tsx": eager(DxLoading) },
    });
    configureRouter({ loadingFallback: component("GLOBAL-CONFIG-FALLBACK") });

    // The bug this pins: `dx/loading.tsx` used to paint only for a page
    // directly under `dx/`. With the boundary as a pathless route in front of
    // every route `dx` emits, a page at `dx/y/z` still renders inside
    // `LOADING-DX`, and the intermediate `y` and `z` folders (which own no
    // boundary file) let the ancestor's placeholder reach them.
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ["/dx/y/z"] },
        React.createElement(() => useRoutes(routes))),
    );
    assert.ok(html.includes("LOADING-DX"), `expected dx's placeholder for a two-levels-below page, got: ${html}`);
    assert.ok(!html.includes("GLOBAL-CONFIG-FALLBACK"), "the folder placeholder still wins over the configured fallback");
  });

  test("a nested folder's loading.tsx overrides its parent's (LOADING-OWN)", () => {
    const ParentLoading = component("LOADING-PARENT");
    const OwnLoading = component("LOADING-OWN");
    const suspending = pendingPage();
    const { routes } = generate({
      pages: { "parent/page.tsx": async () => pendingPage().default,
               "parent/own/page.tsx": async () => suspending.default },
      loadings: {
        "parent/loading.tsx": eager(ParentLoading),
        "parent/own/loading.tsx": eager(OwnLoading),
      },
    });

    // The inner boundary publishes its own placeholder through
    // `RouteLoadingContext`, so the deepest folder's `loading.tsx` wins for
    // its page - the Next.js contract - while the parent's still applies to
    // its own base.
    const ownHtml = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ["/parent/own"] },
        React.createElement(() => useRoutes(routes))),
    );
    const parentHtml = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ["/parent"] },
        React.createElement(() => useRoutes(routes))),
    );
    assert.ok(ownHtml.includes("LOADING-OWN"), `own loading wins, got: ${ownHtml}`);
    assert.ok(!ownHtml.includes("LOADING-PARENT"), "the parent's loading is overridden below");
    assert.ok(parentHtml.includes("LOADING-PARENT"), "the parent's loading still applies to its own base");
  });

  test("a route group's loading.tsx guards every page beneath it", () => {
    const GrpLoading = component("LOADING-GRP");
    const suspending = pendingPage();
    const { routes } = generate({
      pages: { "sec/(grp)/gpage/page.tsx": async () => suspending.default },
      loadings: { "sec/(grp)/loading.tsx": eager(GrpLoading) },
    });
    configureRouter({ loadingFallback: component("GLOBAL-CONFIG-FALLBACK") });

    // The user reported that `(grp)/loading.tsx` had no effect - the group
    // route was transparent with no element. The group's pathless route now
    // carries the boundary element itself, so every page under the group (a
    // direct child here, or one deeper) paints the group's placeholder.
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ["/sec/gpage"] },
        React.createElement(() => useRoutes(routes))),
    );
    assert.ok(html.includes("LOADING-GRP"), `expected the group placeholder, got: ${html}`);
    assert.ok(!html.includes("GLOBAL-CONFIG-FALLBACK"), "the group's loading wins over the configured fallback");
  });

  test("a not-found renders inside the folder's boundary, not as an error", () => {
    const NotFound = component("NOT-FOUND");
    const { routes } = generate({
      pages: { "docs/intro/page.tsx": loader("intro") },
      notFounds: { "not-found.tsx": loader(NotFound) },
      errors: { "error.tsx": eager(component("ROOT-ERROR")) },
    });

    // `/docs` has no page, so the base guard renders the nearest `not-found`
    // inside the root boundary. A not-found is a completed render, not a
    // thrown error - so the boundary must paint the not-found, not the
    // `error.tsx`. This pins the Next.js ordering `error > loading >
    // not-found > page`.
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ["/docs"] },
        React.createElement(() => useRoutes(routes))),
    );
    assert.ok(!html.includes("ROOT-ERROR"), `a not-found is not treated as an error, got: ${html}`);
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

  test("reset() clears the boundary state so the subtree re-renders", () => {
    const Fallback = component("err");
    const boundary = makeBoundary(Fallback);
    boundary.state = { error: new Error("boom") };
    let applied = null;
    boundary.setState = (partial) => { applied = partial; };

    // Grab the `reset` callback handed to the user's `error.tsx`.
    const element = boundary.render();
    element.props.reset();
    assert.deepEqual(applied, { error: null },
      "reset only clears state - the subtree below is what React re-renders next");
  });
});

describe("reset() scope: a failed dynamic import stays failed", () => {
  // `reset()` retries the *render*, not the *fetch*. The boundary clears its
  // error state and React walks the subtree again, but `createLazyElement`
  // hands back the same `React.lazy` instance for a cache key, and `React.lazy`
  // memoizes a rejected loader forever. These three tests pin the contract:
  // the router cache is stable, `React.lazy` does not re-invoke a rejected
  // loader, and `reset()` therefore cannot recover from a stale-deploy chunk
  // without a document reload (or an explicit `clearLazyCache(cache)` paired
  // with a remount).
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("the router cache memoizes one React.lazy per key", () => {
    const cache = createLazyCache();
    let calls = 0;
    const loader = () => { calls += 1; return Promise.resolve({ default: component("ok") }); };

    const first = createLazyElement(loader, "page:dx/y/z", cache);
    const second = createLazyElement(loader, "page:dx/y/z", cache);

    // Same `React.lazy` under the same key: whatever state the first render
    // leaves on that instance is what every later render - including the one
    // `reset()` triggers - reads. Neither call has run the loader yet; lazy
    // defers the fetch to render time, but the identity is fixed after the
    // first call.
    assert.equal(first.props.children.type, second.props.children.type,
      "one memoized lazy component per cache key");
    assert.equal(calls, 0, "`lazy(fn)` does not invoke fn until the render reads it");
  });

  test("React.lazy caches a rejection, so reset cannot re-fetch a failed chunk", async () => {
    let calls = 0;
    const failingLoader = () => {
      calls += 1;
      return Promise.reject(new Error("chunk missing"));
    };
    const cache = createLazyCache();
    // `createLazyElement` wraps the lazy in its own Suspense whose fallback
    // reads the configured fallback, so name that one to make the pending
    // state observable from the rendered HTML.
    configureRouter({ loadingFallback: component("FALLBACK") });
    const element = () => createLazyElement(failingLoader, "page:dx/y/z", cache);

    // First read kicks the load. `renderToStaticMarkup` renders synchronously
    // and paints the Suspense fallback while the promise is still pending; the
    // rejection lands after the render returns and React stores it on the
    // memoized `React.lazy` payload.
    renderToStaticMarkup(element());
    await flush();

    // Second and third reads exercise the SAME memoized `React.lazy`. The
    // payload is already in its rejected state, so React neither re-invokes
    // the loader nor resolves the subtree - the fallback paints again.
    const html2 = renderToStaticMarkup(element());
    const html3 = renderToStaticMarkup(element());

    assert.ok(html2.includes("FALLBACK"), `the retry paints the fallback again, got: ${html2}`);
    assert.ok(html3.includes("FALLBACK"), `a third read still does not resolve, got: ${html3}`);
    assert.equal(calls, 1,
      "`React.lazy` calls its loader exactly once; `reset()` on the boundary "
      + "cannot make it re-fire because it does not touch this memoization");
  });

  test("clearLazyCache(cache) evicts the rejection so a real retry becomes possible", async () => {
    // The one lever `reset()` cannot reach on its own: dropping the memoized
    // component from the router's cache. This is the escape hatch for an app
    // that wants a true "hard retry" button above the router - `reset()`
    // alone only clears the boundary's error state.
    let calls = 0;
    const failingThenPassing = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("chunk missing"))
        : Promise.resolve({ default: component("RECOVERED") });
    };
    const cache = createLazyCache();
    configureRouter({ loadingFallback: component("FALLBACK") });
    const render = () => renderToStaticMarkup(
      createLazyElement(failingThenPassing, "page:x", cache),
    );

    // First pass kicks the load; the rejection lands on the lazy payload and
    // every later read stays on the fallback because the loader is not asked
    // again.
    render();
    await flush();
    assert.ok(render().includes("FALLBACK"));
    assert.ok(render().includes("FALLBACK"));
    assert.equal(calls, 1, "one loader invocation until the cache is cleared");

    // Dropping the memoized component forces the next `createLazyElement`
    // call to build a fresh `React.lazy`, which then runs its loader again.
    clearLazyCache(cache);
    const kickedAgain = render();
    await flush();
    const recovered = render();

    assert.equal(calls, 2, "the loader is re-invoked once the cache entry is gone");
    assert.ok(!kickedAgain.includes("RECOVERED"), "the pass that re-fires the loader still paints the fallback");
    assert.ok(recovered.includes("RECOVERED"), `the next pass paints the recovered page, got: ${recovered}`);
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
