import type { RouteErrorProps } from "next-vite-router";

// `ERROR-IS-NULL` is what the suite looks for: it can only appear when the
// boundary captured the `null` and still handed over the folder's `error.tsx`.
export default function NullThrowError({ error, reset }: RouteErrorProps) {
  return (
    <div data-testid="null-error">
      {error === null ? "ERROR-IS-NULL" : `ERROR-IS-${String(error)}`}
      {" "}
      <button type="button" data-testid="null-reset" onClick={reset}>retry</button>
    </div>
  );
}
