import assert from "node:assert/strict";
import { test, describe } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, useRoutes } from "react-router-dom";
import {
  buildRouteTree,
  clearLazyCache,
  createLazyCache,
  createLazyElement,
  treeToRoutes,
} from "../dist/index.js";
// The boundary components are engine internals reached through the same build
// entry the generated routes module resolves by path (never a package specifier).
import {
  NotFoundBoundary,
  RedirectGate,
  RedirectGateBoundary,
  RouteErrorBoundary,
  RouteLoadingProvider,
  SegmentBoundary,
} from "../dist/plugin-runtime.js";
import {
  NotFoundSignal,
  RedirectSignal,
  RenderContext,
  createRenderOutcome,
  notFound,
} from "../dist/plugin-runtime.js";

const loader = (name) => async () => ({ default: name });
// An eager `import.meta.glob` yields the module namespace, whose `default` is
// the component - the shape `loading.tsx` / `error.tsx` are always read in.
const eager = (name) => ({ default: name });
const component = (name) => function Component() {
  return React.createElement("div", null, name);
};

test("RedirectGate classifies redirect signals for client navigation", () => {
  const state = RedirectGateBoundary.getDerivedStateFromError(
    new RedirectSignal("/login", false, true),
  );
  assert.deepEqual(state, {
    signal: { to: "/login", replace: true },
  });
});

test("RedirectGate clears a caught redirect only when the location changes", () => {
  // The boundary must survive a navigation: remounting it would remount every
  // boundary below, clearing an `error.tsx` on a query-only navigation. Only the
  // redirect state is dropped, and only once the new location is the one on
  // screen (otherwise the `<Navigate>` it is rendering would be discarded).
  const boundary = new RedirectGateBoundary({ resetKey: "a", children: null });
  let applied = null;
  boundary.setState = (partial) => { applied = partial; };
  boundary.state = RedirectGateBoundary.getDerivedStateFromError(
    new RedirectSignal("/login", false, true),
  );

  boundary.componentDidUpdate({ resetKey: "a" });
  assert.equal(applied, null, "the same location keeps the redirect on screen");

  boundary.componentDidUpdate({ resetKey: "b" });
  assert.deepEqual(applied, { signal: null }, "a new location clears it");
});

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

/**
 * The `NotFoundBoundary` element a pathless owner wrapper carries, when the
 * route's element is the `RenderContextOverride` the converter installs: the
 * wrapper names the owning folder and the `page` phase, and the boundary
 * beneath it renders an `<Outlet/>` for everything the folder emits. The root
 * always installs one as the first route it guards; a folder installs one as
 * its first child when it declares `not-found.tsx`.
 */
const notFoundBoundaryOf = (element) => {
  if (!element
    || typeof element.type !== "function"
    || typeof element.props?.owner !== "string"
    || element.props?.phase !== "page") {
    return undefined;
  }
  const boundary = element.props.children;
  return boundary?.type === NotFoundBoundary ? boundary : undefined;
};

/**
 * The routes a boundary route guards: its children, descended through the
 * not-found owner wrapper when one sits between the boundary and the content
 * (the wrapper forwards through its own `<Outlet/>`, so its children are the
 * guarded routes).
 */
const guardedChildrenOf = (boundaryRoute) => {
  const wrapperRoute = boundaryRoute?.children
    ?.find((child) => notFoundBoundaryOf(child.element));
  return wrapperRoute ? wrapperRoute.children : boundaryRoute?.children;
};

function generate(records) {
  const tree = buildRouteTree(records);
  return { tree, routes: treeToRoutes(tree, true) };
}

describe("converter: boundary placement", () => {
  test("a leaf without boundary files stays compact under the root's not-found wrapper", () => {
    const { routes } = generate({
      pages: { "shop/page.tsx": loader("shop") },
    });

    // No loading/error anywhere: the leaf emits no SegmentBoundary and no
    // extra pathless route, exactly as before these files existed. The root
    // does always install the not-found owner wrapper - a pathless route
    // whose element is the RenderContextOverride around the NotFoundBoundary
    // rendering an Outlet - and the leaf is its sibling inside that wrapper.
    const root = routes[0];
    assert.equal(root.path, "/");
    const wrapperRoute = root.children.find((route) => notFoundBoundaryOf(route.element));
    assert.ok(wrapperRoute, "the root installs the not-found owner wrapper");
    const rootBoundary = notFoundBoundaryOf(wrapperRoute.element);
    assert.equal(rootBoundary.props.owner, "/");
    assert.equal(rootBoundary.props.parentOwner, "/");
    assert.equal(rootBoundary.props.children.type, Outlet, "the wrapper forwards through an Outlet");

    const shop = wrapperRoute.children.find((route) => route.path === "shop");
    assert.ok(shop, "the page route is emitted inside the wrapper");
    assert.ok(!isBoundary(shop.element), "no SegmentBoundary shows up for a leaf without files");
    assert.ok(!shop.children, "a leaf without a boundary stays a leaf");
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
    const root = routes[0];
    assert.equal(root.path, "/");
    const shopRoute = guardedChildrenOf(root).find((route) => route.path === "shop");
    assert.ok(shopRoute, "the folder is emitted under the root's wrapper");
    const boundary = boundaryOf(shopRoute);
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
    const root = routes[0];
    const shopRoute = guardedChildrenOf(root).find((route) => route.path === "shop");
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
    const root = routes[0];
    const shopRoute = guardedChildrenOf(root).find((route) => route.path === "shop");
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
    const root = routes[0];
    const shopRoute = guardedChildrenOf(root).find((route) => route.path === "shop");
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
    const root = routes[0];
    const shop = guardedChildrenOf(root).find((route) => route.path === "shop");
    assert.ok(shop, "the group is dropped from the emitted tree");
    assert.ok(!guardedChildrenOf(root).some((route) => route.path === "(marketing)"));
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

    // A group is a folder like any other for boundary purposes: a pathless
    // route inside the group's own pathless route carries the boundary
    // element, so every descendant - a leaf page directly under the group and
    // a page two levels below it - renders inside the same boundary.
    const root = routes[0];
    const sec = guardedChildrenOf(root).find((route) => route.path === "sec");
    const grp = sec.children.find((route) => route.path === undefined);
    assert.ok(grp, "the group emits a pathless route");
    const grpBoundary = boundaryOf(grp);
    assert.ok(grpBoundary, "the group nests a pathless route carrying the boundary");
    assert.ok(isBoundary(grpBoundary.element), "the nested pathless route carries the boundary");
    assert.equal(grpBoundary.element.props.loading, GrpLoading);
    assert.equal(grpBoundary.element.props.error, GrpError);
    const gpage = grpBoundary.children.find((route) => route.path === "gpage");
    const other = grpBoundary.children.find((route) => route.path === "other");
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
    const root = routes[0];
    const dx = guardedChildrenOf(root).find((route) => route.path === "dx");
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
    // The root's not-found owner wrapper sits between its error boundary and
    // everything it guards, forwarding through its own Outlet.
    const wrapperRoute = boundary.children.find((route) => notFoundBoundaryOf(route.element));
    assert.ok(wrapperRoute, "the not-found owner wrapper sits inside the root boundary");
    const about = wrapperRoute.children.find((route) => route.path === "about");
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

    // The root also installs the not-found owner wrapper between its error
    // boundary and everything it guards; the wrapper forwards through an
    // Outlet, so the guarded routes are its children.
    const wrapperRoute = rootBoundary.children.find((route) => notFoundBoundaryOf(route.element));
    assert.ok(wrapperRoute, "the root's not-found owner wrapper sits inside its boundary");
    const rootNf = notFoundBoundaryOf(wrapperRoute.element);
    assert.equal(rootNf.props.owner, "/");
    assert.equal(rootNf.props.parentOwner, "/");
    assert.equal(rootNf.props.children.type, Outlet);
    const guarded = wrapperRoute.children;

    // The deep page case: `dx/error.tsx` must reach `dx/y/z/page.tsx` even
    // when neither `dx/y` nor `dx/y/z` owns a `layout.tsx` or boundary file.
    // The intermediate folders contribute no element of their own, so the
    // only shape that gets this right is the boundary pathless route in
    // front of every route `dx` emits.
    const dx = guarded.find((route) => route.path === "dx");
    const dxBoundary = boundaryOf(dx);
    assert.equal(dxBoundary.element.props.error, DxError);
    const y = dxBoundary.children.find((route) => route.path === "y");
    const z = y.children.find((route) => route.path === "z");
    assert.ok(z, "z lives inside dx's boundary at two levels deep");

    // The group case: `(grp)` carries its own loading + error on a pathless
    // route nested inside the group's own pathless route, so `gpage` renders
    // inside the boundary without the group needing a layout of its own.
    const sec = guarded.find((route) => route.path === "sec");
    const grp = sec.children.find((route) => route.path === undefined);
    const grpBoundary = boundaryOf(grp);
    assert.ok(isBoundary(grpBoundary.element), "the group nests a route carrying the boundary");
    assert.equal(grpBoundary.element.props.loading, GrpLoading);
    assert.equal(grpBoundary.element.props.error, GrpError);
    const gpage = grpBoundary.children.find((route) => route.path === "gpage");
    assert.ok(gpage, "the grouped page lives inside the group boundary");

    // The root's `not-found` is a `*` route inside the root's boundary, so it
    // paints inside the layout (Next.js contract), not beside or above it.
    const notFound = guarded.find((route) => route.path === "*");
    assert.ok(notFound, "the not-found splat renders inside the root boundary");
  });

  test("an owning not-found folder wraps its page in the signal boundary", () => {
    const ChildNotFound = component("CHILD-NOT-FOUND");
    const { routes } = generate({
      pages: { "shop/page.tsx": loader(component("SHOP")) },
      notFounds: { "shop/not-found.tsx": loader(ChildNotFound) },
    });

    const root = routes[0];
    const shop = guardedChildrenOf(root).find((route) => route.path === "shop");
    assert.ok(shop, "the shop route exists");
    // The declaring folder installs the owner wrapper as its first child: a
    // pathless route whose element is the RenderContextOverride around the
    // NotFoundBoundary, which forwards the folder's whole subtree - page and
    // not-found splat alike - through its Outlet.
    const wrapperRoute = shop.children.find((route) => notFoundBoundaryOf(route.element));
    assert.ok(wrapperRoute, "the owner wrapper is the folder's first child");
    const wrapperElement = wrapperRoute.element;
    assert.equal(wrapperElement.props.owner, "/shop");
    assert.equal(wrapperElement.props.phase, "page");
    const boundary = notFoundBoundaryOf(wrapperElement);
    assert.ok(boundary, "the wrapper element wraps the NotFoundBoundary signal boundary");
    assert.equal(boundary.props.owner, "/shop");
    assert.equal(boundary.props.parentOwner, "/");
    assert.equal(boundary.props.children.type, Outlet);
    assert.equal(boundary.props.fallback().type, React.Suspense);
    const page = wrapperRoute.children.find((route) => route.index);
    assert.ok(page, "the page renders inside the boundary as an index");
    const splat = wrapperRoute.children.find((route) => route.path === "*");
    assert.ok(splat, "the folder's not-found splat renders inside the boundary too");
  });

  test("inherits an ancestor not-found fallback when the child has none", () => {
    const { routes } = generate({
      pages: {
        "shop/page.tsx": loader(component("SHOP")),
        "shop/cart/page.tsx": loader(component("CART")),
      },
      notFounds: { "shop/not-found.tsx": loader(component("SHOP-NOT-FOUND")) },
    });

    const root = routes[0];
    const shop = guardedChildrenOf(root).find((route) => route.path === "shop");
    // The nearest declaring owner wraps cart: shop's owner wrapper guards the
    // whole subtree, so cart renders through the inherited boundary's Outlet
    // and inherits shop's fallback.
    const wrapperRoute = shop.children.find((route) => notFoundBoundaryOf(route.element));
    assert.ok(wrapperRoute, "shop's owner wrapper is the sole route shop emits");
    const cart = wrapperRoute.children.find((route) => route.path === "cart");
    assert.ok(cart, "the cart route exists");
    assert.ok(!isBoundary(cart.element), "cart carries no boundary of its own");
    assert.ok(!notFoundBoundaryOf(cart.element), "cart carries no not-found boundary of its own");
    const boundary = notFoundBoundaryOf(wrapperRoute.element);
    assert.equal(boundary.props.owner, "/shop");
    assert.equal(boundary.props.fallback().type, React.Suspense);
    assert.ok(wrapperRoute.children.includes(cart),
      "cart renders through the inherited boundary's outlet");
  });

  test("keeps the declaring owner for a deeply inherited root fallback", () => {
    const { routes } = generate({
      pages: { "shop/cart/page.tsx": loader(component("CART")) },
      notFounds: { "not-found.tsx": loader(component("ROOT-NOT-FOUND")) },
    });

    const root = routes[0];
    assert.equal(root.path, "/");
    // No folder between the page and the root declares `not-found.tsx`, so
    // the root's own owner wrapper guards the deep page: the fallback keeps
    // the owner that declared it, and the page renders through its Outlet.
    const wrapperRoute = root.children.find((route) => notFoundBoundaryOf(route.element));
    assert.ok(wrapperRoute, "the root wrapper guards every page below");
    const boundary = notFoundBoundaryOf(wrapperRoute.element);
    assert.equal(boundary.props.owner, "/", "the root keeps the declaring owner");
    assert.equal(boundary.props.parentOwner, "/", "the root fallback has no deeper parent owner");
    assert.equal(boundary.props.fallback().type, React.Suspense, "the declared fallback is lazy");

    const shop = guardedChildrenOf(root).find((route) => route.path === "shop");
    const cart = shop.children.find((route) => route.path === "cart");
    assert.ok(cart, "the deep page exists");
    assert.ok(!notFoundBoundaryOf(cart.element), "no private boundary replaces the declaring owner");
    const shopInside = wrapperRoute.children.find((route) => route.path === "shop");
    assert.ok(shopInside, "the shop folder renders through the root boundary's outlet");
    assert.ok(shopInside.children.includes(cart),
      "so the deep page renders inside the root boundary too");
    // The folder's base also answers with the inherited root fallback, under
    // the same declaring owner.
    const baseGuard = shop.children.find((route) => route.index && route.handle?.notFound);
    assert.ok(baseGuard, "the folder's base is a guard index");
    assert.equal(baseGuard.element.props.owner, "/");
    assert.equal(baseGuard.element.props.phase, "fallback");
    assert.equal(baseGuard.element.props.children.type, React.Suspense);
  });

  test("terminates re-entry from a deeply inherited root fallback", () => {
    // The root's owner wrapper guards every deep page (per-page boundaries are
    // gone), so the fallback a deep page inherits is painted by the root
    // boundary itself. Re-entering it must hard-error: there is no boundary
    // above the root to hand the signal to.
    const outcome = createRenderOutcome({ pathname: "/", search: "", hash: "" });
    const Fallback = () => notFound();
    const boundary = new NotFoundBoundary({
      owner: "/",
      parentOwner: "/",
      fallback: Fallback,
      children: null,
    });
    boundary.context = {
      outcome,
      owner: "/",
      phase: "page",
    };
    boundary.state = NotFoundBoundary.getDerivedStateFromError(
      new NotFoundSignal("/"),
    );

    const fallbackElement = boundary.render();
    assert.throws(
      () => renderToStaticMarkup(fallbackElement),
      /cannot re-enter the root fallback/,
    );
    assert.equal(outcome.reentrantSignal, null);
  });

  test("records a reentrant signal when a folder's fallback re-enters its parent owner", () => {
    // A folder boundary (shop declares `not-found.tsx`, so its wrapper owns
    // the fallback with the root as parent) is not the root itself: re-entry
    // escapes with a reentrant NotFoundSignal aimed at the parent owner, and
    // the outcome records it for the server pass to degrade on - the render
    // still terminates, so the loop cannot spin.
    const outcome = createRenderOutcome({ pathname: "/shop", search: "", hash: "" });
    const Fallback = () => notFound();
    const boundary = new NotFoundBoundary({
      owner: "/shop",
      parentOwner: "/",
      fallback: Fallback,
      children: null,
    });
    boundary.context = {
      outcome,
      owner: "/shop",
      phase: "page",
    };
    boundary.state = NotFoundBoundary.getDerivedStateFromError(
      new NotFoundSignal("/shop"),
    );

    // The boundary's own fallback element wires the parent handoff: the
    // provider it paints names the parent owner and the boundary painting.
    const fallbackElement = boundary.render();
    assert.equal(fallbackElement.type, RenderContext.Provider);
    assert.equal(fallbackElement.props.value.owner, "/");
    assert.equal(fallbackElement.props.value.fallbackOwner, "/shop");
    assert.throws(
      () => renderToStaticMarkup(fallbackElement),
      (error) => error instanceof NotFoundSignal
        && error.owner === "/"
        && error.reentrant,
    );
    assert.deepEqual(outcome.reentrantSignal, {
      kind: "not-found",
      owner: "/",
      reentrant: true,
    });
  });

  test("local fallback re-entry uses its parent owner instead of itself", () => {
    const outcome = createRenderOutcome({ pathname: "/", search: "", hash: "" });
    const Fallback = () => notFound();
    const boundary = new NotFoundBoundary({
      owner: "/shop",
      parentOwner: "/",
      fallback: Fallback,
      children: null,
    });
    boundary.context = {
      outcome,
      owner: "/shop",
      phase: "page",
    };
    boundary.state = NotFoundBoundary.getDerivedStateFromError(
      new NotFoundSignal("/shop"),
    );

    assert.throws(
      () => renderToStaticMarkup(React.createElement(
        RenderContext.Provider,
        { value: { outcome, owner: "/shop", phase: "fallback" } },
        React.createElement(Fallback),
      )),
      (error) => error instanceof NotFoundSignal
        && error.owner === "/shop"
        && error.reentrant,
    );
    assert.deepEqual(outcome.reentrantSignal, {
      kind: "not-found",
      owner: "/shop",
      reentrant: true,
    });
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

  test("loading.tsx is the folder's placeholder while its page is pending", () => {
    const ShopLoading = component("SHOP-LOADING");
    const suspending = pendingPage();
    const { routes } = generate({
      pages: { "shop/page.tsx": async () => suspending.default },
      loadings: { "shop/loading.tsx": eager(ShopLoading) },
    });

    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/shop"] },
        React.createElement(() => useRoutes(routes)),
      ),
    );

    assert.ok(html.includes("SHOP-LOADING"), `expected the folder placeholder, got: ${html}`);
  });

  test("a folder without loading.tsx paints nothing while its page is pending", () => {
    const { routes } = generate({
      pages: {
        "shop/page.tsx": async () => pendingPage().default,
        "about/page.tsx": async () => pendingPage().default,
      },
      loadings: { "shop/loading.tsx": eager(component("SHOP-LOADING")) },
    });

    const shopHtml = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ["/shop"] },
        React.createElement(() => useRoutes(routes))),
    );
    const aboutHtml = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ["/about"] },
        React.createElement(() => useRoutes(routes))),
    );

    assert.ok(shopHtml.includes("SHOP-LOADING"));
    // `about` declared no placeholder and there is no configured fallback to
    // answer for it, so the pending page renders nothing at all - no markup, and
    // no empty element left in the DOM.
    assert.equal(aboutHtml, "");
  });

  test("a folder's loading.tsx reaches a page several levels below", () => {
    const DxLoading = component("LOADING-DX");
    const suspending = pendingPage();
    const { routes } = generate({
      pages: { "dx/y/z/page.tsx": async () => suspending.default },
      loadings: { "dx/loading.tsx": eager(DxLoading) },
    });

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

  test("a route group's loading.tsx covers every page beneath it", () => {
    const GrpLoading = component("LOADING-GRP");
    const suspending = pendingPage();
    const { routes } = generate({
      pages: { "sec/(grp)/gpage/page.tsx": async () => suspending.default },
      loadings: { "sec/(grp)/loading.tsx": eager(GrpLoading) },
    });

    // The user reported that `(grp)/loading.tsx` had no effect - the group
    // route was transparent with no element. The group's pathless route now
    // carries the boundary element itself, so every page under the group (a
    // direct child here, or one deeper) paints the group's placeholder.
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ["/sec/gpage"] },
        React.createElement(() => useRoutes(routes))),
    );
    assert.ok(html.includes("LOADING-GRP"), `expected the group placeholder, got: ${html}`);
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
  // navigation - are pinned directly on the lifecycle methods. A thrown value is
  // handed to `render()` as React would hand it to the state, and the element it
  // returns is streamed, so `error.tsx` painting is proven and not assumed.
  const makeBoundary = (error, state, resetKey = "/a") => {
    const boundary = new RouteErrorBoundary({ error, resetKey, children: null });
    if (state) boundary.state = state;
    return boundary;
  };

  /**
   * The `resetKey` a folder boundary hands its guard for `url`, read out of the
   * element `SegmentBoundary` creates instead of written by hand here: the
   * lifecycle calls below compare the value `useLocation()` actually produced, so
   * a key that drifted away from the pathname fails this helper rather than
   * quietly changing the contract.
   */
  const resetKeyFor = (url) => {
    let created;
    const Probe = () => {
      created = SegmentBoundary({ error: component("err"), children: null });
      return null;
    };
    renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: [url] }, React.createElement(Probe)),
    );
    return created.props.children.props.resetKey;
  };

  test("derives the thrown error into state", () => {
    const thrown = new Error("boom");
    assert.deepEqual(RouteErrorBoundary.getDerivedStateFromError(thrown), {
      hasError: true,
      error: thrown,
    });
  });

  test("rethrows control-flow signals instead of rendering error.tsx", () => {
    const signal = new NotFoundSignal("/a");
    const boundary = makeBoundary(component("SCREEN"), {
      hasError: true,
      error: signal,
    });

    assert.throws(() => boundary.render(), (error) => error === signal);

    const redirectSignal = new RedirectSignal("/login", false, false);
    boundary.state = { hasError: true, error: redirectSignal };
    assert.throws(() => boundary.render(), (error) => error === redirectSignal);
  });

  describe("NotFoundBoundary lifecycle", () => {
    const fallback = component("NOT-FOUND");
    const child = React.createElement("i", null, "page");

    test("renders children while healthy and the owned fallback after a signal", () => {
      const boundary = new NotFoundBoundary({
        owner: "/shop",
        fallback,
        children: child,
        parentOwner: "/",
      });

      assert.equal(boundary.render(), child);
      const signal = new NotFoundSignal("/shop");
      boundary.state = NotFoundBoundary.getDerivedStateFromError(signal);
      const element = boundary.render();

      assert.equal(element.type, RenderContext.Provider);
      assert.equal(element.props.value.owner, "/");
      assert.equal(element.props.value.phase, "fallback");
      assert.equal(element.props.children.type, fallback);
    });

    test("rethrows a signal owned by another segment", () => {
      const boundary = new NotFoundBoundary({
        owner: "/shop",
        fallback,
        children: child,
      });
      const signal = new NotFoundSignal("/other");
      boundary.state = NotFoundBoundary.getDerivedStateFromError(signal);

      assert.throws(() => boundary.render(), (error) => error === signal);
    });

    test("rethrows ordinary failures instead of painting a 404", () => {
      const boundary = new NotFoundBoundary({
        owner: "/shop",
        fallback,
        children: child,
      });
      const failure = new Error("broken");
      boundary.state = NotFoundBoundary.getDerivedStateFromError(failure);

      assert.throws(() => boundary.render(), (error) => error === failure);
    });

    test("paints the owned fallback from a recorded outcome on the server", () => {
      // `renderToPipeableStream` never runs a class catch, so pass 2 is driven by
      // the outcome: the boundary reads the recorded signal and paints, with the
      // same owner rule the client catch applies.
      const outcome = createRenderOutcome({ pathname: "/shop", search: "", hash: "" });
      outcome.recordSignal({ kind: "not-found", owner: "/shop", reentrant: false }, "page");
      const boundary = new NotFoundBoundary({
        owner: "/shop",
        fallback,
        children: child,
        parentOwner: "/",
      });
      boundary.context = { outcome, owner: "/shop", phase: "fallback" };

      const element = boundary.render();
      assert.equal(element.type, RenderContext.Provider);
      // The server paint carries the noindex meta, the fallback, and the inert
      // marker the client reads to paint the same tree on its first render.
      const content = element.props.children;
      assert.equal(content.type, React.Fragment);
      const painted = content.props.children;
      assert.equal(painted[0].type, "meta");
      assert.equal(painted[0].props.name, "robots");
      assert.equal(painted[1].type, fallback);
      assert.equal(painted[2].type, "script");
      assert.equal(painted[2].props.id, "__NVR_NOT_FOUND__");
      assert.equal(element.props.value.owner, "/");
      assert.equal(element.props.value.phase, "fallback");
    });

    test("the marker is readable by more than one boundary instance", () => {
      // React may build an instance it never keeps (StrictMode double-invokes the
      // constructor, a concurrent render can be abandoned). Reading the marker
      // must not consume it: a throwaway instance may not hide the fallback from
      // the instance React actually commits.
      const previous = globalThis.document;
      globalThis.document = {
        getElementById: (id) =>
          id === "__NVR_NOT_FOUND__"
            ? { textContent: JSON.stringify({ kind: "not-found", owner: "/shop" }) }
            : null,
      };
      try {
        const first = new NotFoundBoundary({ owner: "/shop", fallback, children: child });
        const second = new NotFoundBoundary({ owner: "/shop", fallback, children: child });
        assert.equal(first.state.hasError, true);
        assert.equal(second.state.hasError, true);
      } finally {
        if (previous === undefined) {
          delete globalThis.document;
        } else {
          globalThis.document = previous;
        }
      }
    });

    test("the marker script neutralizes HTML-significant characters", () => {
      // The owner is app data, but it is written into a `<script>` element: a raw
      // `</script>` in it would end the element and open a new one. Escaping `<`,
      // `>` and `&` keeps the JSON parseable and the element inert.
      const owner = "/x</script><script>alert(1)</script>";
      const outcome = createRenderOutcome({ pathname: "/x", search: "", hash: "" });
      outcome.recordSignal({ kind: "not-found", owner, reentrant: false }, "page");
      const boundary = new NotFoundBoundary({
        owner,
        fallback,
        children: child,
        parentOwner: "/",
      });
      boundary.context = { outcome, owner, phase: "fallback" };

      const content = boundary.render().props.children;
      // The meta element is painted first; the marker script follows the fallback.
      const script = content.props.children[2];
      const html = script.props.dangerouslySetInnerHTML.__html;
      assert.ok(!html.includes("<"), html);
      assert.ok(!html.includes(">"), html);
      assert.ok(!html.includes("&"), html);
      assert.deepEqual(JSON.parse(html), { kind: "not-found", owner });
    });

    test("does not paint another owner's recorded signal", () => {
      const outcome = createRenderOutcome({ pathname: "/shop", search: "", hash: "" });
      outcome.recordSignal({ kind: "not-found", owner: "/other", reentrant: false }, "page");
      const boundary = new NotFoundBoundary({
        owner: "/shop",
        fallback,
        children: child,
      });
      boundary.context = { outcome, owner: "/shop", phase: "fallback" };

      assert.equal(boundary.render(), child);
    });
  });

  // Every kind of value a component may legally throw. `null` is the one a
  // boundary cannot express with a single field: the state used `{ error: null }`
  // both for "nothing failed" and for `throw null`, so such a failure read as
  // healthy, the subtree rendered again, and the folder's `error.tsx` never
  // appeared. `hasError` is what decides, so the value itself never has to be
  // truthy - and the falsy members of this list (`undefined`, `""`, `0`, `false`,
  // `NaN`) are pinned beside it so no future check can shorten it with `!`.
  const THROWN_VALUES = [
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["zero", 0],
    ["false", false],
    ["NaN", NaN],
    ["a string", "boom"],
    ["an Error", new Error("boom")],
  ];

  for (const [label, thrown] of THROWN_VALUES) {
    test(`catches a thrown ${label}`, () => {
      const Fallback = component("SCREEN");
      const child = React.createElement("i", null, "ok");
      const boundary = new RouteErrorBoundary({
        error: Fallback,
        resetKey: "/a",
        children: child,
      });

      // Healthy until something fails: the subtree renders untouched.
      assert.equal(boundary.render(), child);

      boundary.state = RouteErrorBoundary.getDerivedStateFromError(thrown);

      const element = boundary.render();
      assert.notEqual(element, child, `a thrown ${label} must not re-render the subtree`);
      assert.equal(element.type, Fallback, `a thrown ${label} renders the folder's error.tsx`);
      assert.ok(
        Object.is(element.props.error, thrown),
        `the thrown ${label} reaches error.tsx unchanged`,
      );
      assert.equal(typeof element.props.reset, "function");
      // The fallback really paints instead of rendering nothing for a falsy value.
      assert.match(renderToStaticMarkup(element), /SCREEN/);
    });
  }

  test("clears a caught error when the pathname changes", () => {
    const Fallback = component("err");
    const boundary = makeBoundary(Fallback, { hasError: true, error: new Error("boom") });
    // A stub setState records the reset a real mount would apply.
    let reset = false;
    boundary.setState = () => { reset = true; };

    boundary.componentDidUpdate({ resetKey: "/a" });
    assert.equal(reset, false, "same pathname keeps the error on screen");
    boundary.componentDidUpdate({ resetKey: "/b" });
    assert.equal(reset, true, "a new pathname clears it, so another page of the folder is not stuck on the error");
  });

  test("clears a captured null when the pathname changes", () => {
    // The reset paths read the same `hasError` flag, so a `throw null` failure
    // also stops covering the next page of the folder - the case the old
    // `state.error !== null` comparison could never even reach, the two states
    // having been one and the same value.
    const boundary = makeBoundary(component("err"), { hasError: true, error: null });
    let applied = null;
    boundary.setState = (partial) => { applied = partial; };

    boundary.componentDidUpdate({ resetKey: "/a" });
    assert.equal(applied, null, "the same pathname keeps the captured value on screen");
    boundary.componentDidUpdate({ resetKey: "/b" });
    assert.deepEqual(applied, { hasError: false, error: undefined });
  });

  test("the reset key is the pathname, not the whole URL", () => {
    // Pinned as a decision. The key drops the query and the hash, so a boundary
    // re-considers its caught failure only when the path it guards moves - which
    // is what makes `error.tsx` a file of the folder rather than of one URL.
    assert.equal(resetKeyFor("/dashboard?tab=home"), "/dashboard");
    assert.equal(resetKeyFor("/dashboard?tab=home#steps"), "/dashboard");
    assert.equal(
      resetKeyFor("/dashboard?tab=settings"),
      resetKeyFor("/dashboard?tab=home"),
      "a query-only navigation does not move the key",
    );
    assert.notEqual(
      resetKeyFor("/dashboard/settings?tab=home"),
      resetKeyFor("/dashboard?tab=home"),
      "a path-only navigation does",
    );
  });

  test("keeps a caught error across a query-only navigation", () => {
    // `/dashboard?tab=home` then `/dashboard?tab=settings`: the same page under a
    // different query, so the screen stays. The failure may well have been caused
    // by the value that just changed, and a retry then would re-render the very
    // subtree that threw - `reset()` on the folder's `error.tsx` is the deliberate
    // way back, and the browser suite proves the kept screen really is stale.
    const before = resetKeyFor("/dashboard?tab=home");
    const after = resetKeyFor("/dashboard?tab=settings");
    const boundary = makeBoundary(component("err"),
      { hasError: true, error: new Error("boom") }, after);
    let reset = false;
    boundary.setState = () => { reset = true; };

    boundary.componentDidUpdate({ resetKey: before });

    assert.equal(after, before, "the key the boundary compares is unchanged by the query");
    assert.equal(reset, false, "so the error keeps its place on screen");
  });

  test("clears it when the path changes under an unchanged query", () => {
    // The other half of the same rule: `?tab=fail` is carried along into a
    // sibling page of the folder and has no say in the decision, so the next page
    // is never held hostage by a failure that belonged to another one.
    const before = resetKeyFor("/dashboard?tab=fail");
    const after = resetKeyFor("/dashboard/settings?tab=fail");
    const boundary = makeBoundary(component("err"),
      { hasError: true, error: new Error("boom") }, after);
    let applied = null;
    boundary.setState = (partial) => { applied = partial; };

    boundary.componentDidUpdate({ resetKey: before });

    assert.notEqual(after, before, "the path alone moved the key");
    assert.deepEqual(applied, { hasError: false, error: undefined },
      "and the boundary cleared the failure it was holding");
  });

  test("renders children while healthy and the fallback once failed", () => {
    const Fallback = component("SCREEN");
    const child = React.createElement("i", null, "ok");
    const healthy = new RouteErrorBoundary({ error: Fallback, resetKey: "/a", children: child });
    assert.equal(healthy.render(), child, "a healthy boundary renders its subtree untouched");

    const failed = makeBoundary(Fallback, { hasError: true, error: new Error("boom") });
    const element = failed.render();
    assert.equal(element.type, Fallback);
    assert.equal(element.props.error.message, "boom");
    assert.equal(typeof element.props.reset, "function");
  });

  test("reset() clears the boundary state so the subtree re-renders", () => {
    const Fallback = component("err");
    const boundary = makeBoundary(Fallback, { hasError: true, error: new Error("boom") });
    let applied = null;
    boundary.setState = (partial) => { applied = partial; };

    // Grab the `reset` callback handed to the user's `error.tsx`.
    const element = boundary.render();
    element.props.reset();
    assert.deepEqual(applied, { hasError: false, error: undefined },
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
  //
  // The half this harness cannot reach is the other end of the same story: a
  // request a real browser cannot fetch, a placeholder that must not hang, and a
  // document that has to be replaced. That runs in `test/browser/app.spec.js`
  // ("a stale-deploy chunk failure…"), which aborts the chunk request of
  // `test/browser-app/src/app/chunk/` in dev and from the production bundle.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * Render a `createLazyElement` result under a folder placeholder. The element
   * carries its own `Suspense`, and the placeholder it paints arrives through
   * `RouteLoadingContext` - the folder's `loading.tsx`, and the only fallback
   * there is - so the pending state is observable from the rendered HTML only
   * when the element is wrapped in the provider a boundary would place above it.
   */
  const renderLazyWithLoading = (element, Loading) => renderToStaticMarkup(
    React.createElement(RouteLoadingProvider, { loading: Loading }, element),
  );

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
    const Pending = component("FALLBACK");
    const element = () => createLazyElement(failingLoader, "page:dx/y/z", cache);

    // First read kicks the load. `renderToStaticMarkup` renders synchronously
    // and paints the folder's placeholder while the promise is still pending;
    // the rejection lands after the render returns and React stores it on the
    // memoized `React.lazy` payload.
    renderLazyWithLoading(element(), Pending);
    await flush();

    // Second and third reads exercise the SAME memoized `React.lazy`. The
    // payload is already in its rejected state, so React neither re-invokes
    // the loader nor resolves the subtree - the placeholder paints again.
    const html2 = renderLazyWithLoading(element(), Pending);
    const html3 = renderLazyWithLoading(element(), Pending);

    assert.ok(html2.includes("FALLBACK"), `the retry paints the placeholder again, got: ${html2}`);
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
    const Pending = component("FALLBACK");
    const render = () => renderLazyWithLoading(
      createLazyElement(failingThenPassing, "page:x", cache),
      Pending,
    );

    // First pass kicks the load; the rejection lands on the lazy payload and
    // every later read stays on the placeholder because the loader is not asked
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
