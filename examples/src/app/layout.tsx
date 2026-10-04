import { Link, Outlet } from "react-router-dom";

export default function RootLayout() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 800, margin: "2rem auto" }}>
      <h1>next-vite-router examples</h1>
      <nav style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link to="/basic">Basic</Link>
        <Link to="/layouts">Layouts</Link>
        <Link to="/dynamic-routes/42">Dynamic routes</Link>
        <Link to="/middleware">Middleware</Link>
        <Link to="/typed-routes">Typed routes</Link>
      </nav>
      <hr />
      <Outlet />
    </main>
  );
}
