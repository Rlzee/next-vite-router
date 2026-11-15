import { createElement as h } from "react";

// A folder `error.tsx` must never answer a control-flow signal: if the 404 case
// regresses, this marker appears instead of the not-found and the entry says so.
export default function GoneError() {
  return h("div", { "data-error": "gone" }, "err:gone");
}