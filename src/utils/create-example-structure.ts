import fs from "fs";
import path from "path";

// Contents for layout.tsx and page.tsx

const layoutContentNoTailwind = `import { Outlet } from "react-router-dom";
import "@/globals.css";

export default function Layout() {
  return (
    <main>
      <Outlet />
    </main>
  );
}
`;

const layoutContentTailwind = `import { Outlet } from "react-router-dom";
import "@/globals.css";

export default function Layout() {
  return (
    <main className="min-h-screen bg-background">
      <Outlet />
    </main>
  );
}
`;

const pageContentNoTailwind = `export default function Page() {
  return <h1>Welcome to the next-vite-router project!</h1>;
}
`;

const pageContentTailwind = `export default function Page() {
  return <h1 className="text-2xl font-bold">Welcome to the next-vite-router project!</h1>;
}
`;

const examplePageContent = `export default function ExamplePage() {
  return <h1>Welcome to the example page!</h1>;
}
`;

// Create example structure
export function createExampleStructure(
  projectDir: string,
  src: boolean,
  tailwindcss: boolean
) {
  const appDir = src
    ? path.join(projectDir, "src", "app")
    : path.join(projectDir, "app");

  // Create app directory
  if (!fs.existsSync(appDir)) {
    fs.mkdirSync(appDir, { recursive: true });
  }

  // Create layout.tsx
  const layoutContent = tailwindcss
    ? layoutContentTailwind
    : layoutContentNoTailwind;

  fs.writeFileSync(path.join(appDir, "layout.tsx"), layoutContent, "utf-8");

  // Create page.tsx
  const pageContent = tailwindcss ? pageContentTailwind : pageContentNoTailwind;

  fs.writeFileSync(path.join(appDir, "page.tsx"), pageContent, "utf-8");

  // Create example subdirectory
  const exampleDir = path.join(appDir, "example");
  if (!fs.existsSync(exampleDir)) {
    fs.mkdirSync(exampleDir, { recursive: true });
  }

  // Create example/page.tsx
  fs.writeFileSync(
    path.join(exampleDir, "page.tsx"),
    examplePageContent,
    "utf-8"
  );
}