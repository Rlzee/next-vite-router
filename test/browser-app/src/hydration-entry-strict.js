import React from "react";
import { hydrateRoot } from "react-dom/client";
import { buildElement } from "./hydration-fixture.js";

// The StrictMode twin of `hydration-entry.js`. React double-invokes the
// constructor of a class it mounts, so the marker must survive a boundary
// instance that is built and thrown away. Bundled with the development React
// build, because StrictMode only double-invokes in development.
window.__recoverable = [];

hydrateRoot(
  document.getElementById("root"),
  React.createElement(React.StrictMode, null, buildElement(undefined)),
  {
    onRecoverableError(error) {
      window.__recoverable.push(String(error));
    },
  },
);