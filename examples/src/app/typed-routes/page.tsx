import { RouteLink, href } from "virtual:next-vite-router";
import type { RoutePath } from "virtual:next-vite-router";

const currentPath = "/typed-routes" satisfies RoutePath;

export default function TypedRoutesExample() {
  const userId = "42";

  return (
    <section>
      <h2>Typed routes</h2>
      <p>Known path: {currentPath}</p>
      <p>
        Pattern resolved to a URL:{" "}
        <code>{href("/dynamic-routes/:id", { id: userId })}</code>
      </p>
      <p>
        <RouteLink to="/dynamic-routes/:id" params={{ id: userId }}>
          Open the dynamic route
        </RouteLink>
      </p>
      <p>
        TypeScript rejects a <code>RouteLink</code> whose{" "}
        <code>to</code> is not a generated route, and one that omits{" "}
        <code>params</code> for a pattern that has them.
      </p>
    </section>
  );
}
