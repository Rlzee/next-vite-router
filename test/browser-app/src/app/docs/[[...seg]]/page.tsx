import { useCatchAll } from "next-vite-router/routes";

// An optional catch-all: `[[...seg]]` also answers its own base (`/docs`), so the
// suite can read the segment array in both shapes - empty at the base, one or
// more below it.
export default function DocsPage() {
  const segments = useCatchAll();
  return <div data-testid="docs-page">{`DOCS{${segments.join("|")}}`}</div>;
}
