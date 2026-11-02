import path from "path";
import { projectRelativePath, writeFileIfMissing } from "./write-if-missing";

// The starter route tree: a root layout, a home page that says what the plugin
// does, and one more page proving the router picked a folder up by its name.
//
// Both files style themselves through the class names `createGlobalsCss` writes,
// and never through a file on disk. The mark in the header is inline SVG rather
// than an import, so a scaffold that deleted the template's `assets/` folder has
// nothing left to fail on, and the colors follow the reader's color-scheme
// preference instead of a hardcoded white.

const layoutContent = (pages: string) => `import { Link, Outlet } from "react-router-dom";
import "@/globals.css";

export default function RootLayout() {
  return (
    <div className="shell">
      <header className="masthead">
        <Link className="brand" to="/">
          <svg
            aria-hidden="true"
            className="logo"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M4 20V4l16 16V4" />
          </svg>
          <span>next-vite-router</span>
        </Link>
        <nav className="tabs">
          <Link to="/">Home</Link>
          <Link to="/example">Example</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="footer">
        This shell is <code>${pages}/layout.tsx</code>. Each page below it renders
        into the <code>Outlet</code>.
      </footer>
    </div>
  );
}
`;

const homePageContent = (pages: string, cssFile: string, tailwind: boolean) => {
  // Only a Tailwind project may be told a utility class does something: without
  // the dependency the class list below is inert text in the markup.
  const tailwindNote = tailwind
    ? `      <p className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm">
        Tailwind CSS is wired into this project. Its utilities are imported at the
        top of <code>${cssFile}</code>, so the class on this paragraph already
        applies.
      </p>
`
    : "";

  return `import { Link } from "next-vite-router/routes";

export default function Page() {
  return (
    <section>
      <h1>Next.js-style routes, on Vite</h1>
      <p className="lede">
        A page is a file. <code>${pages}/example/page.tsx</code> is the route
        linked at the bottom of this one, and nothing registers it anywhere else.
      </p>
${tailwindNote}      <ul className="cards">
        <li className="card">
          <h2>Add a route</h2>
          <p>
            Create <code>${pages}/about/page.tsx</code> and open{" "}
            <code>/about</code>. The plugin rebuilds the route list while the dev
            server runs.
          </p>
        </li>
        <li className="card">
          <h2>Give it a param</h2>
          <p>
            <code>${pages}/users/[id]/page.tsx</code> becomes <code>/users/:id</code>,
            and reads its value with <code>useParams()</code>.
          </p>
        </li>
        <li className="card">
          <h2>Stay typed</h2>
          <p>
            <code>Link</code> and <code>href</code> come from{" "}
            <code>next-vite-router/routes</code>, whose generated types list only
            the routes this folder declares.
          </p>
        </li>
      </ul>
      <p>
        <Link href="/example">Open the example page</Link>
      </p>
    </section>
  );
}
`;
};

const examplePageContent = (pages: string) => `export default function ExamplePage() {
  return (
    <section>
      <h1>An ordinary page</h1>
      <p className="lede">
        This is <code>${pages}/example/page.tsx</code>. The folder named the path
        segment; the file name stayed out of the URL.
      </p>
      <p>
        Add a sibling folder with its own <code>page.tsx</code> and it becomes a
        route on its own. Rename this folder and <code>/example</code> goes away
        with it.
      </p>
    </section>
  );
}
`;

/**
 * Create the example route tree.
 *
 * Returns the project-relative paths it found already written and left alone: a
 * project that already has its own `app/page.tsx` keeps it, because that page is
 * its work, not a placeholder to replace.
 */
export function createExampleStructure(
  projectDir: string,
  src: boolean,
  tailwindcss: boolean,
): string[] {
  const appDir = src
    ? path.join(projectDir, "src", "app")
    : path.join(projectDir, "app");
  const pages = src ? "src/app" : "app";
  const cssFile = src ? "src/globals.css" : "globals.css";

  const files: readonly [string, string][] = [
    ["layout.tsx", layoutContent(pages)],
    ["page.tsx", homePageContent(pages, cssFile, tailwindcss)],
    [path.join("example", "page.tsx"), examplePageContent(pages)],
  ];

  const kept: string[] = [];
  for (const [relativePath, content] of files) {
    const filePath = path.join(appDir, relativePath);
    if (!writeFileIfMissing(filePath, content)) {
      kept.push(projectRelativePath(projectDir, filePath));
    }
  }

  return kept;
}
