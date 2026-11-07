import type { RouteErrorProps } from "next-vite-router";

// Reads the thrown value defensively: `error` is whatever was thrown, so the
// fixture stringifies rather than assuming an `Error` instance.
export default function BrokenError({ error, reset }: RouteErrorProps) {
  return (
    <div data-testid="broken-error">
      {"BROKEN-ERROR "}
      <span data-testid="broken-message">{String(error && (error as Error).message)}</span>
      {" "}
      <button type="button" data-testid="broken-reset" onClick={reset}>retry</button>
    </div>
  );
}
