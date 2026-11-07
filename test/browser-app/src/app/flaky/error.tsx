import type { RouteErrorProps } from "next-vite-router";
import { failureSwitch } from "./switch";

export default function FlakyError({ error, reset }: RouteErrorProps) {
  return (
    <div data-testid="flaky-error">
      {"FLAKY-ERROR "}
      <span data-testid="flaky-message">{String((error as Error)?.message)}</span>
      {" "}
      <button
        type="button"
        data-testid="flaky-reset"
        onClick={() => {
          // Remove the cause, then retry the subtree: exactly what the README
          // promises `reset()` can recover from, and nothing more.
          failureSwitch.armed = false;
          reset();
        }}
      >
        retry
      </button>
    </div>
  );
}
