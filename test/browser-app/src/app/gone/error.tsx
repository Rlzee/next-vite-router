/**
 * Present on purpose: a control-flow signal must never reach `error.tsx`. If it
 * did, this marker would replace the 404 and the browser test would say so.
 */
export default function GoneError() {
  return <div data-testid="gone-error">GONE-ERROR</div>;
}