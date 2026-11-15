import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";

/**
 * The redirect target. It is an ordinary page: the gate that navigated here has
 * remounted with an empty signal, so this page renders instead of the redirect
 * being replayed. The query is echoed so the second redirect is observable.
 */
export default function RedirectLoginPage() {
  const { search } = useLocation();

  return (
    <>
      <div data-testid="login-page">{`LOGIN-PAGE${search}`}</div>
      <Link to="/redirect/loop" data-testid="nav-loop">loop</Link>
    </>
  );
}