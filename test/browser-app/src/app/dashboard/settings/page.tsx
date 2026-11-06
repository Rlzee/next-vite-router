/**
 * A second page of the `dashboard` folder, so the folder has two pathnames under
 * one `error.tsx`.
 *
 * It ignores the query on purpose: reaching it from the failing tab carries
 * `?tab=fail` along, the value that produced the error screen. That page then
 * rendering instead of the screen can only mean the boundary let the stale
 * failure go because the *path* moved - not because the new location happened to
 * be a healthy tab.
 */
export default function DashboardSettingsPage() {
  return <div data-testid="dashboard-settings-page">DASHBOARD-SETTINGS</div>;
}
