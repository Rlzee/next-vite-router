import type { RouteErrorProps } from "next-vite-router";

/**
 * The screen for a page whose chunk never arrived - the stale-deploy case the
 * README describes. `error` here is the browser's own `TypeError` from a
 * rejected `import()`, not a value the app threw, so the message is printed
 * rather than assumed.
 *
 * Both buttons are deliberately offered, because they are not the same ask:
 * `reset()` retries the render, which a memoized chunk rejection survives, while
 * the reload replaces the document and asks the server for the file again.
 */
export default function ChunkError({ error, reset }: RouteErrorProps) {
  return (
    <div data-testid="chunk-error">
      {"CHUNK-ERROR "}
      <span data-testid="chunk-message">{String((error as Error)?.message)}</span>
      {" "}
      <button type="button" data-testid="chunk-reset" onClick={reset}>retry</button>
      {" "}
      <button type="button" data-testid="chunk-reload" onClick={() => window.location.reload()}>
        reload
      </button>
    </div>
  );
}
