import { createElement as h } from "react";
import { Outlet } from "react-router-dom";

// Nested layout, to prove an `Outlet` still renders inside a second layout
// level on every combination.
export default function UsersLayout() {
  return h("section", { "data-layout": "users" }, "[users", h(Outlet), "/users]");
}
