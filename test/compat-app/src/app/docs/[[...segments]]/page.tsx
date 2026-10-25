import { createElement as h } from "react";
import { useCatchAll } from "next-vite-router/routes";

// Optional catch-all: unlike `[...slug]`, the base path `/docs` renders the page.
export default function Docs() {
  const segments = useCatchAll();
  return h("div", { "data-page": "docs" }, `docs{${segments.join("|")}}`);
}
