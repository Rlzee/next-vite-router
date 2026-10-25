import { createElement as h } from "react";
import { useCatchAll } from "next-vite-router/routes";

// Required catch-all: `/blog` must answer with the not-found, `/blog/...` with
// the page and its segments.
export default function BlogPost() {
  const segments = useCatchAll();
  return h("div", { "data-page": "blog" }, `blog{${segments.join("|")}}`);
}
