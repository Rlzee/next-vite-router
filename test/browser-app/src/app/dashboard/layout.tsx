import { Link, Outlet, useLocation } from "react-router-dom";

/**
 * Tab bar for the `dashboard` folder, written with React Router's own `Link`
 * because `to` accepts a full URL: the generated `Link` takes a route *pattern*
 * from `RoutePath` and carries no query string.
 *
 * The bar lives in the layout, not in the page, because a folder's `layout.tsx`
 * renders *outside* its own `error.tsx` - so it stays clickable while a failure
 * screen is on screen, which is what makes a query-only navigation observable at
 * all. It also echoes the tab it is rendering, which is the other half: it proves
 * the location really changed above the boundary, instead of the persisted error
 * being an app that never re-rendered.
 *
 * The three targets separate the two halves of the boundary's reset key:
 * `?tab=ok` changes only the query, `settings?tab=fail` changes only the path.
 */
export default function DashboardLayout() {
  const tab = new URLSearchParams(useLocation().search).get("tab") ?? "none";

  return (
    <div data-testid="dashboard-layout">
      {"DASHBOARD-LAYOUT["}
      <nav>
        <span data-testid="dashboard-tab">{tab}</span>{" "}
        <Link to="/dashboard?tab=fail" data-testid="tab-fail">failing tab</Link>
        {" "}
        <Link to="/dashboard?tab=ok" data-testid="tab-ok">healthy tab</Link>
        {" "}
        <Link to="/dashboard/settings?tab=fail" data-testid="tab-settings">other page</Link>
      </nav>
      <Outlet />
      {"]DASHBOARD-LAYOUT"}
    </div>
  );
}
