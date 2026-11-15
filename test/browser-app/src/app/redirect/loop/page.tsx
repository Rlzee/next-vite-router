import { redirect } from "next-vite-router/routes";

/**
 * A second redirect, reached from the first target: the gate must have cleared
 * its signal for the login page to be on screen, and must catch again here.
 */
export default function RedirectLoopPage() {
  redirect("/redirect/login?second=1");
}