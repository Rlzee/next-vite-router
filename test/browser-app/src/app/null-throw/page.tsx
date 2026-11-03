// Throws `null` - legal JavaScript, and the value an error boundary has to treat
// as a failure anyway. A boundary that stores "no failure" and the captured value
// in the same field reads this as healthy and renders the failing subtree again.
export default function NullThrowPage() {
  throw null;
}
