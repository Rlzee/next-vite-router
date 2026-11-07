import { Outlet } from "react-router-dom";
import { Link } from "next-vite-router/routes";

// The root shell. Every marker string is asserted twice over: as visible text in
// the browser, and as a string literal inside the built chunks (the code-split
// proof). Navigation goes through the generated `Link`, so the typed `href` +
// `params` pair is exercised on a real click instead of only in a unit test.
export default function RootLayout() {
  return (
    <div data-testid="root-layout">
      {"ROOT-LAYOUT["}
      <nav>
        <Link href="/" data-testid="nav-home">home</Link>
        {" "}
        <Link href="/users/:id" params={{ id: "42" }} data-testid="nav-user">user</Link>
        {" "}
        <Link href="/docs/*" params={{ seg: ["guide", "api"] }} data-testid="nav-docs">docs</Link>
        {" "}
        <Link href="/shop" data-testid="nav-shop">shop</Link>
        {" "}
        <Link href="/broken" data-testid="nav-broken">broken</Link>
        {" "}
        <Link href="/flaky" data-testid="nav-flaky">flaky</Link>
        {" "}
        <Link href="/null-throw" data-testid="nav-null-throw">null-throw</Link>
        {" "}
        <Link href="/chunk" data-testid="nav-chunk">chunk</Link>
      </nav>
      <Outlet />
      {"]ROOT-LAYOUT"}
    </div>
  );
}
