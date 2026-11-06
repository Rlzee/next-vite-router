import type { RouteErrorProps } from "next-vite-router";

/**
 * The `dashboard` folder's failure screen. Its `reset` is plain: the cause of the
 * failure is the query string, which the reader changes through the layout's tab
 * bar rather than through this button, so - unlike `flaky` - there is no switch
 * here to disarm. What the button does prove is which side of the boundary a
 * surviving screen belongs to.
 */
export default function DashboardError({ error, reset }: RouteErrorProps) {
  return (
    <div data-testid="dashboard-error">
      {"DASHBOARD-ERROR "}
      <span data-testid="dashboard-message">{String((error as Error)?.message)}</span>
      {" "}
      <button type="button" data-testid="dashboard-reset" onClick={reset}>retry</button>
    </div>
  );
}
