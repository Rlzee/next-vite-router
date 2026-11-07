/**
 * The failure condition of the `flaky` folder, in its own module so both the page
 * and the folder's `error.tsx` read and write the same instance.
 *
 * A counter of *renders* would not do: React re-renders a subtree while it works
 * out whether a failure is reproducible, so "fail the first render only" can be
 * consumed by a render the user never sees. A flag the retry clears says exactly
 * what the test means - the cause of the failure is gone before the second try.
 */
export const failureSwitch = { armed: true };
