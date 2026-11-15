import { createElement as h } from "react";
import { notFound } from "next-vite-router/routes";

// The SSR flow-control case: `notFound()` records its owner and throws, so the
// response is a 404 whose body is this folder's fallback (painted by the second
// pass), never the page and never an `error.tsx`.
export default function Gone() {
  notFound();
}