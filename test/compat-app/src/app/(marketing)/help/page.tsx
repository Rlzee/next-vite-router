import { createElement as h } from "react";

// Inside a route group, so the URL (`/help`) proves the folder is pathless.
export default function Help() {
  return h("div", { "data-page": "help" }, "help");
}
