import { createElement as h } from "react";
import { Outlet } from "react-router-dom";
import { Link, href } from "next-vite-router/routes";

// Eager root layout: wraps every page, and renders the generated navigation
// helpers so each streamed document proves they resolve patterns the same way
// on React Router 6 and 7 (`href` encodes, `Link` forwards to React Router).
export default function RootLayout() {
  const docsBase = href("/docs/*", {});
  return h(
    "div",
    { "data-layout": "root" },
    "[root",
    h(Outlet),
    h(Link, { href: "/users/:id", params: { id: "7" } }, "user-7"),
    h(Link, { href: "/blog/*", params: { slug: ["a b", "c?d"] } }, "blog-post"),
    h("span", { "data-href": docsBase }, "docs-base"),
    "/root]",
  );
}
