import assert from "node:assert/strict";
import { test, describe } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RenderContext,
  createRenderOutcome,
  isNotFoundSignal,
  isRedirectSignal,
  notFound,
  permanentRedirect,
  redirect,
} from "../dist/plugin-runtime.js";

const request = { pathname: "/products", search: "", hash: "" };

function renderWithContext(outcome, value, Component) {
  return renderToStaticMarkup(
    React.createElement(
      RenderContext.Provider,
      { value: { outcome, owner: "/products", phase: "page", ...value } },
      React.createElement(Component),
    ),
  );
}

describe("flow signals", () => {
  test("records the owner before throwing notFound", () => {
    const outcome = createRenderOutcome(request);

    assert.throws(
      () => renderWithContext(outcome, {}, () => notFound()),
      (error) => isNotFoundSignal(error)
        && error.owner === "/products"
        && error.reentrant === false,
    );
    assert.deepEqual(outcome.signal, {
      kind: "not-found",
      owner: "/products",
      reentrant: false,
    });
  });

  test("records a reentrant notFound in the fallback slot", () => {
    const outcome = createRenderOutcome(request);

    assert.throws(
      () => renderWithContext(outcome, { phase: "fallback", owner: "/parent" }, () => notFound()),
      (error) => isNotFoundSignal(error)
        && error.owner === "/parent"
        && error.reentrant === true,
    );
    assert.equal(outcome.signal, null);
    assert.deepEqual(outcome.reentrantSignal, {
      kind: "not-found",
      owner: "/parent",
      reentrant: true,
    });
  });

  test("records redirect status and client replacement independently", () => {
    const outcome = createRenderOutcome(request);

    assert.throws(
      () => renderWithContext(outcome, {}, () => redirect(new URL("/login", "https://example.test"), { replace: true })),
      (error) => isRedirectSignal(error)
        && error.to === "https://example.test/login"
        && error.permanent === false
        && error.replace === true,
    );
    assert.deepEqual(outcome.signal, {
      kind: "redirect",
      to: "https://example.test/login",
      permanent: false,
      replace: true,
    });
  });

  test("records permanent redirects with replace false by default", () => {
    const outcome = createRenderOutcome(request);

    assert.throws(
      () => renderWithContext(outcome, {}, () => permanentRedirect("/archive")),
      (error) => isRedirectSignal(error)
        && error.to === "/archive"
        && error.permanent === true
        && error.replace === false,
    );
  });

  test("rejects flow control outside route rendering", () => {
    assert.throws(
      () => notFound(),
      /can only be used during route rendering/,
    );
  });
});

describe("render outcomes", () => {
  test("keeps the first signal and failure in their respective slots", () => {
    const outcome = createRenderOutcome(request);
    outcome.recordSignal({ kind: "not-found", owner: "/a", reentrant: false }, "page");
    outcome.recordSignal({ kind: "not-found", owner: "/b", reentrant: false }, "page");
    outcome.recordSignal({ kind: "not-found", owner: "/parent", reentrant: true }, "fallback");
    outcome.recordSignal({ kind: "not-found", owner: "/other", reentrant: true }, "fallback");
    outcome.recordFailure(new Error("pass 3"), 3);
    outcome.recordFailure(new Error("later"), 1);

    assert.equal(outcome.signal?.owner, "/a");
    assert.equal(outcome.reentrantSignal?.owner, "/parent");
    assert.equal(outcome.failure?.pass, 3);
    assert.equal(outcome.failure?.error.message, "pass 3");
  });
});
