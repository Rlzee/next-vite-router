import { failureSwitch } from "./switch";

// Fails every render while its folder's switch is armed, so the boundary cannot
// miss it; the `error.tsx` disarms the switch before it retries the subtree.
export default function FlakyPage() {
  if (failureSwitch.armed) {
    throw new Error("flaky failure");
  }
  return <div data-testid="flaky-page">FLAKY-PAGE</div>;
}
