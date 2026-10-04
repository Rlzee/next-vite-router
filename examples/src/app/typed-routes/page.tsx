import type { RoutePath } from "virtual:next-vite-router";

const currentPath = "/typed-routes" satisfies RoutePath;

export default function TypedRoutesExample() {
  return (
    <section>
      <h2>Typed routes</h2>
      <p>Known path: {currentPath}</p>
    </section>
  );
}
