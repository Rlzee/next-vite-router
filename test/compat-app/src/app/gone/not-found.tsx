import { createElement as h } from "react";

export default function GoneNotFound() {
  return h("div", { "data-not-found": "gone" }, "nf:gone");
}