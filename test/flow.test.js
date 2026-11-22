import assert from "node:assert/strict";
import { describe, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RenderContext, notFound, redirect, permanentRedirect,
  isNotFoundSignal, isRedirectSignal, isRenderSignal,
  NotFoundSignal, RedirectSignal, NotFoundBoundary,
  RedirectGateBoundary, RouteErrorBoundary,
} from "../dist/plugin-runtime.js";

function render(value, Component) {
  return renderToStaticMarkup(React.createElement(
    RenderContext.Provider, { value }, React.createElement(Component),
  ));
}

describe("client flow control", () => {
  test("notFound carries the nearest fallback owner", () => {
    assert.throws(
      () => render({ owner: "/products", phase: "page" }, () => notFound()),
      (error) => isNotFoundSignal(error) && error.owner === "/products",
    );
  });

  test("fallbacks can escalate but cannot re-enter the root fallback", () => {
    assert.throws(
      () => render({ owner: "/", phase: "fallback", fallbackOwner: "/products" }, () => notFound()),
      (error) => isNotFoundSignal(error) && error.owner === "/",
    );
    assert.throws(
      () => render({ owner: "/", phase: "fallback", fallbackOwner: "/" }, () => notFound()),
      /cannot re-enter the root fallback/,
    );
  });

  test("redirects accept strings and URLs and preserve history options", () => {
    for (const [helper, permanent] of [[redirect, false], [permanentRedirect, true]]) {
      for (const replace of [false, true]) {
        assert.throws(
          () => render({ phase: "page" }, () => helper(new URL("/login", "https://example.test"), { replace })),
          (error) => isRedirectSignal(error)
            && error.to === "https://example.test/login"
            && error.permanent === permanent && error.replace === replace,
        );
      }
      assert.throws(
        () => render({ phase: "page" }, () => helper("/login")),
        (error) => isRedirectSignal(error) && !error.replace,
      );
    }
  });

  test("helpers reject use outside route rendering", () => {
    // A React render without our provider is a valid hook call, but not a route.
    for (const helper of [notFound, () => redirect("/"), () => permanentRedirect("/")]) {
      assert.throws(() => renderToStaticMarkup(React.createElement(helper)), /only be used during route rendering/);
    }
  });

  test("ordinary errors cannot impersonate control signals", () => {
    for (const value of [null, undefined, new Error("NEXT_VITE_ROUTER_NOT_FOUND"), { owner: "/" }]) {
      assert.equal(isRenderSignal(value), false);
    }
  });

  test("error.tsx rethrows both signals and still renders ordinary failures", () => {
    const boundary = new RouteErrorBoundary({ error: () => null, resetKey: "/", children: null });
    for (const error of [new NotFoundSignal("/"), new RedirectSignal("/login", false, false)]) {
      boundary.state = RouteErrorBoundary.getDerivedStateFromError(error);
      assert.throws(() => boundary.render(), (thrown) => thrown === error);
    }
    boundary.state = RouteErrorBoundary.getDerivedStateFromError(null);
    assert.equal(boundary.render().props.error, null);
  });

  test("not-found boundaries only handle their own owner", () => {
    const boundary = new NotFoundBoundary({
      owner: "/products", parentOwner: "/", fallback: "404", resetKey: "/", children: "page",
    });
    assert.equal(boundary.render(), "page");
    boundary.state = NotFoundBoundary.getDerivedStateFromError(new NotFoundSignal("/products"));
    const fallback = boundary.render();
    assert.equal(fallback.props.children, "404");
    assert.deepEqual(fallback.props.value, { owner: "/", phase: "fallback", fallbackOwner: "/products" });
    for (const error of [new NotFoundSignal("/"), new Error("broken"), new RedirectSignal("/", false, false)]) {
      boundary.state = NotFoundBoundary.getDerivedStateFromError(error);
      assert.throws(() => boundary.render(), (thrown) => thrown === error);
    }
  });

  test("redirect gate only accepts redirects", () => {
    assert.deepEqual(
      RedirectGateBoundary.getDerivedStateFromError(new RedirectSignal("/login", true, true)),
      { signal: { to: "/login", replace: true } },
    );
    for (const error of [new Error("broken"), new NotFoundSignal("/")]) {
      assert.throws(() => RedirectGateBoundary.getDerivedStateFromError(error), (thrown) => thrown === error);
    }
  });

  test("redirect state clears before painting a new location", () => {
    assert.equal(
      RedirectGateBoundary.getDerivedStateFromProps({ resetKey: "origin" }, { resetKey: "origin" }),
      null,
    );
    assert.deepEqual(
      RedirectGateBoundary.getDerivedStateFromProps({ resetKey: "target" }, { resetKey: "origin" }),
      { signal: null, resetKey: "target" },
    );
  });
});
