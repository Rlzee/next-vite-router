import { notFound } from "next-vite-router/routes";

/**
 * Calls `notFound()` while rendering: the URL must stay `/gone`, the folder's
 * `not-found.tsx` must answer, and the `error.tsx` beside it must not.
 */
export default function GonePage() {
  notFound();
}