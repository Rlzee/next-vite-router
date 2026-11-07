// Fails on every render, so the folder's `error.tsx` is the only thing that can
// paint - and a `reset()` that re-renders it has to fail again.
export default function BrokenPage() {
  throw new Error("broken page");
}
