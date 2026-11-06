import { useLocation } from "react-router-dom";

/**
 * Fails while the `fail` tab is selected, and renders for any other query.
 *
 * The failure condition lives in the URL instead of in a module switch (the way
 * `flaky` does it) on purpose: the boundary's reset key is the pathname, so this
 * is the one shape where a *query-only* navigation moves the page off its failure
 * without moving the key. A screen that survives that navigation can therefore
 * only be a stale one, not a fresh catch.
 */
export default function DashboardPage() {
  const tab = new URLSearchParams(useLocation().search).get("tab") ?? "none";
  if (tab === "fail") {
    throw new Error("dashboard failure");
  }

  return <div data-testid="dashboard-page">{`DASHBOARD-PAGE:${tab}`}</div>;
}
