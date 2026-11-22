import { Link } from "next-vite-router/routes";

export default function Login() {
  return <div>
    <div data-testid="login-page">LOGIN-PAGE</div>
    <Link href="/redirect/private-replace" data-testid="redirect-again">again</Link>
  </div>;
}
