import { hydrateRoot } from "react-dom/client";
import { buildElement } from "./hydration-fixture.js";

// The test asserts this is empty: `hydrateRoot` must report every recoverable
// error here, not just the ones React also logs through `console.error`.
window.__recoverable = [];

hydrateRoot(document.getElementById("root"), buildElement(undefined), {
  onRecoverableError(error) {
    window.__recoverable.push(String(error));
  },
});