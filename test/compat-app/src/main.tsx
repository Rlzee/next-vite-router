import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Router } from "next-vite-router/routes";

// The client entry mirrors what the CLI scaffolds: the generated `Router` inside
// `BrowserRouter`. It is only ever compiled here (`vite build`), to prove the
// generated module and `react-dom/client` bundle on every matrix combination;
// rendering is asserted by `entry-server.tsx`. `React` is imported so the
// classic JSX runtime is enough, without adding a tsconfig to this app.
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Router />
  </BrowserRouter>,
);
