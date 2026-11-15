import React from "react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import {
  NotFoundBoundary,
  RenderContext,
  notFound,
  useRenderContext,
} from "../../../dist/plugin-runtime.js";

/**
 * A hydration fixture for `notFound()`.
 *
 * It is the same shape the converter emits for a page with a folder fallback: a
 * context override that keeps the parent outcome, a `NotFoundBoundary` owning the
 * page, and the page calling `notFound()` while rendering. The page is eager on
 * purpose: the package's generated pages are lazy, but the question here is the
 * boundary's client catch, not the Suspense boundary above it. Both sides render
 * this exact tree - the server from a recorded outcome, the client from a caught
 * signal - so the fallback markup is the only thing that can differ.
 */

function Layout() {
  return React.createElement(
    "div",
    { "data-testid": "root-layout" },
    "ROOT",
    React.createElement(Marker),
    React.createElement(Outlet),
  );
}

function Marker() {
  React.useEffect(() => {
    window.__hydrated = true;
  }, []);
  return null;
}

function Gone() {
  notFound();
}

function GoneNotFound() {
  return React.createElement(
    "div",
    { "data-testid": "gone-not-found" },
    "GONE-NOT-FOUND",
  );
}

function ContextOverride({ owner, phase, children }) {
  const parent = useRenderContext();
  return React.createElement(
    RenderContext.Provider,
    { value: { ...parent, owner, phase } },
    children,
  );
}

function GoneRoute() {
  return React.createElement(
    ContextOverride,
    { owner: "/gone", phase: "page" },
    React.createElement(
      NotFoundBoundary,
      {
        owner: "/gone",
        parentOwner: "/",
        fallback: GoneNotFound,
      },
      React.createElement(Gone),
    ),
  );
}

export function buildElement(outcome) {
  return React.createElement(
    RenderContext.Provider,
    { value: { outcome, owner: "/", phase: "fallback" } },
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/gone"] },
      React.createElement(
        Routes,
        null,
        React.createElement(
          Route,
          { path: "/", element: React.createElement(Layout) },
          React.createElement(
            Route,
            { path: "gone", element: React.createElement(GoneRoute) },
          ),
        ),
      ),
    ),
  );
}