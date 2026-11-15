import { redirect } from "next-vite-router/routes";

/**
 * Redirects with the default history behavior (`replace: false`), so the entry
 * that asked for the target stays in history and Back returns to it.
 */
export default function PrivatePushPage() {
  redirect("/redirect/login");
}