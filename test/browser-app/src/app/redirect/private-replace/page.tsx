import { redirect } from "next-vite-router/routes";

/**
 * Redirects with `replace: true`: the entry that asked for the target is gone,
 * so Back leaves the target instead of returning to the page that redirected.
 */
export default function PrivateReplacePage() {
  redirect("/redirect/login", { replace: true });
}